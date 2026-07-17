import io
import os
import socket
import sys
import threading
import zipfile
from pathlib import Path
from unittest import mock

import pytest
import requests
from flask import Flask, Response
from werkzeug.serving import make_server


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

from config import ConfigManager  # noqa: E402
from main_cli import SillyTavernCliLauncher  # noqa: E402
from sync_client import SyncClient, _safe_relative_path, parse_share_url  # noqa: E402
from sync_server import SyncServer, create_sync_app  # noqa: E402
from utils.sync_common import (  # noqa: E402
    SyncSecurityError,
    SyncUsageError,
    redact_share_url,
)


TOKEN = "test-secret-token"


def auth_header(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


class LiveServer:
    def __init__(self, app):
        self.server = make_server("127.0.0.1", 0, app, threaded=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self.server.server_port

    def __exit__(self, exc_type, exc, traceback):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()


def test_sync_authentication_and_path_hiding(tmp_path):
    data_dir = tmp_path / "private" / "default-user"
    data_dir.mkdir(parents=True)
    (data_dir / "settings.json").write_text("{}", encoding="utf-8")
    app = create_sync_app(data_dir, lambda: TOKEN)
    client = app.test_client()

    health = client.get("/health")
    unauthenticated = client.get("/info")
    wrong = client.get("/info", headers=auth_header("wrong"))
    info = client.get("/info", headers=auth_header())

    assert health.status_code == 200
    assert health.json["auth_required"] is True
    assert str(data_dir) not in health.get_data(as_text=True)
    assert unauthenticated.status_code == 401
    assert wrong.status_code == 401
    assert info.status_code == 200
    assert str(data_dir) not in info.get_data(as_text=True)


def test_file_endpoint_rejects_traversal_and_directories(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "folder").mkdir()
    app = create_sync_app(data_dir, lambda: TOKEN)
    client = app.test_client()

    assert client.get("/file?path=../../outside", headers=auth_header()).status_code == 403
    assert client.get("/file?path=folder", headers=auth_header()).status_code == 404
    assert client.get("/file", headers=auth_header()).status_code == 400


def test_share_url_parsing_keeps_token_out_of_base_url():
    base, token = parse_share_url("http://192.168.1.10:9999#token=abc123")

    assert base == "http://192.168.1.10:9999"
    assert token == "abc123"
    assert "token" not in base
    assert redact_share_url(
        "http://192.168.1.10:9999#token=abc123"
    ) == "http://192.168.1.10:9999#token=<hidden>"


@pytest.mark.parametrize(
    "url",
    [
        "http://host:9999",
        "ftp://host:9999#token=x",
        "http://user:password@host:9999#token=x",
        "http://host:9999?token=x#token=y",
        "http://host:9999#token=x&extra=y",
        "http://host:9999#token=x&token=y",
    ],
)
def test_share_url_rejects_unsafe_or_incomplete_values(url):
    with pytest.raises(SyncUsageError):
        parse_share_url(url)


def test_manifest_write_path_rejects_internal_symlink(tmp_path):
    base = tmp_path / "data"
    actual = base / "actual"
    actual.mkdir(parents=True)
    try:
        (base / "linked").symlink_to(actual, target_is_directory=True)
    except OSError:
        pytest.skip("当前系统不允许创建符号链接")

    with pytest.raises(SyncSecurityError, match="符号链接"):
        _safe_relative_path(base, "linked/file.txt")


def test_auto_sync_does_not_bypass_zip_security_failure(tmp_path):
    client = SyncClient(
        "http://127.0.0.1:9999#token=test", tmp_path / "data"
    )
    with mock.patch.object(client, "health"), mock.patch.object(
        client, "sync_full_zip", side_effect=SyncSecurityError("unsafe ZIP")
    ), mock.patch.object(client, "sync_incremental") as incremental:
        with pytest.raises(SyncSecurityError, match="unsafe ZIP"):
            client.sync(method="auto")
    incremental.assert_not_called()


def test_real_http_zip_and_incremental_sync(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "settings.json").write_text("one", encoding="utf-8")
    app = create_sync_app(source, lambda: TOKEN)
    destination = tmp_path / "destination"

    with LiveServer(app) as port:
        client = SyncClient(
            f"http://127.0.0.1:{port}#token={TOKEN}", destination
        )
        zip_result = client.sync(method="zip", backup=False)
        assert (destination / "settings.json").read_text(encoding="utf-8") == "one"

        (source / "settings.json").write_text("two", encoding="utf-8")
        (source / "new.txt").write_text("new", encoding="utf-8")
        incremental = client.sync(method="incremental", backup=False)

    assert zip_result["method"] == "zip"
    assert incremental["downloaded_files"] == 2
    assert (destination / "settings.json").read_text(encoding="utf-8") == "two"
    assert (destination / "new.txt").read_text(encoding="utf-8") == "new"


def test_traditional_sync_server_background_lifecycle(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "settings.json").write_text("{}", encoding="utf-8")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = SyncServer(source, port, "127.0.0.1", lambda: TOKEN)
    try:
        assert server.start(block=False) is True
        health = requests.get(f"http://127.0.0.1:{port}/health", timeout=5)
        info = requests.get(
            f"http://127.0.0.1:{port}/info",
            headers=auth_header(),
            timeout=5,
        )

        assert health.status_code == 200
        assert info.status_code == 200
        assert parse_share_url(server.share_url("127.0.0.1"))[1] == TOKEN
    finally:
        server.stop()

    assert server.running is False


def test_traditional_cli_starts_authenticated_sync_server(tmp_path, monkeypatch):
    data_dir = tmp_path / "SillyTavern" / "data" / "default-user"
    data_dir.mkdir(parents=True)
    (data_dir / "settings.json").write_text("{}", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    launcher = object.__new__(SillyTavernCliLauncher)
    launcher.config_manager = ConfigManager(str(tmp_path / "config.json"))
    launcher.sync_server = None
    launcher._get_local_ip = lambda: "127.0.0.1"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    try:
        assert launcher.start_sync_server(port, "127.0.0.1", block=False) is True
        share_url = launcher.sync_server.share_url("127.0.0.1")
        client = SyncClient(share_url, tmp_path / "destination")

        assert client.info()["server_info"]["file_count"] == 1
        assert launcher.get_sync_server_status()["running"] is True
    finally:
        launcher.stop_sync_server()

    assert launcher.config_manager.get("sync.enabled") is False


def test_server_zip_does_not_include_symlink_targets(tmp_path):
    source = tmp_path / "source"
    outside = tmp_path / "outside.txt"
    source.mkdir()
    outside.write_text("secret", encoding="utf-8")
    try:
        (source / "linked.txt").symlink_to(outside)
    except OSError:
        pytest.skip("当前系统不允许创建符号链接")
    app = create_sync_app(source, lambda: TOKEN)
    client = app.test_client()

    response = client.get("/zip", headers=auth_header())
    with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
        assert "linked.txt" not in archive.namelist()
    response.close()


def test_malicious_zip_is_rejected_without_touching_destination(tmp_path):
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        archive.writestr("../outside.txt", "secret")

    app = Flask(__name__)

    @app.get("/zip")
    def get_zip():
        return Response(archive_buffer.getvalue(), mimetype="application/zip")

    destination = tmp_path / "destination"
    destination.mkdir()
    (destination / "keep.txt").write_text("keep", encoding="utf-8")

    with LiveServer(app) as port:
        client = SyncClient(
            f"http://127.0.0.1:{port}#token={TOKEN}", destination
        )
        with pytest.raises(SyncSecurityError, match="ZIP"):
            client.sync_full_zip(backup=False)

    assert (destination / "keep.txt").read_text(encoding="utf-8") == "keep"
    assert not (tmp_path / "outside.txt").exists()


def test_config_generates_and_rotates_private_sync_token(tmp_path):
    config_path = tmp_path / "config.json"
    manager = ConfigManager(str(config_path))
    original = manager.current_sync_token()

    rotated = manager.rotate_sync_token()
    reloaded = ConfigManager(str(config_path))

    assert len(original) >= 32
    assert len(rotated) >= 32
    assert rotated != original
    assert reloaded.current_sync_token() == rotated
    if os.name == "posix":
        assert config_path.stat().st_mode & 0o077 == 0
