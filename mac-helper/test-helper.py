#!/usr/bin/env python3
"""Local-only protocol/listener regression. Pass a DEBUG helper executable.

--test-fixture bypasses SteamTools/DoH and intercepts the one probe request.
This never changes network settings, contacts GitHub, or accesses credentials.
"""
import http.client
import json
import pathlib
import queue
import socket
import subprocess
import sys
import threading
import time


class Helper:
    def __init__(self, executable):
        self.process = subprocess.Popen([str(executable), "--test-fixture"], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.messages = queue.Queue()
        self.next_id = 0
        threading.Thread(target=self.read, daemon=True).start()
        self.event("ready")

    def read(self):
        for line in self.process.stdout:
            self.messages.put(json.loads(line))

    def event(self, wanted):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=10)
            if message.get("event") == wanted:
                return message
        raise AssertionError(f"No {wanted} event")

    def send(self, method):
        self.next_id += 1
        request_id = str(self.next_id)
        self.process.stdin.write(json.dumps({"id": request_id, "method": method}) + "\n")
        self.process.stdin.flush()
        return request_id

    def receive(self, request_id):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=15)
            if message.get("id") == request_id:
                return message
        raise AssertionError(f"No response to {request_id}")

    def call(self, method):
        return self.receive(self.send(method))

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            self.process.wait(timeout=10)
        assert self.process.returncode == 0


def unavailable(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return False
    except OSError:
        return True


def wait_stopped():
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if unavailable(8868) and unavailable(8869):
            return
        time.sleep(0.02)
    raise AssertionError("Helper listeners were not released")


def run(executable):
    if not unavailable(8868) or not unavailable(8869):
        raise RuntimeError("Test ports are occupied; refusing to stop another process")
    helper = Helper(executable)
    try:
        assert helper.call("status")["result"]["status"] == "disconnected"
        assert unavailable(8868) and unavailable(8869), "Status must not start listeners"
        inactive = helper.call("probe")
        assert inactive["ok"] is False and inactive["error"]
        connected = helper.call("start")
        assert connected["ok"] is True and connected["result"]["status"] == "connected", connected
        assert connected["result"]["socksPort"] == 8868
        assert connected["result"]["pacURL"] == "http://127.0.0.1:8869/github.pac"
        connection = http.client.HTTPConnection("127.0.0.1", 8869, timeout=3)
        connection.request("GET", "/github.pac")
        response = connection.getresponse()
        body = response.read().decode()
        assert response.status == 200 and "SOCKS5 127.0.0.1:8868" in body and "return 'DIRECT'" in body
        connection.close()
        with socket.create_connection(("127.0.0.1", 8868), timeout=3) as client:
            client.sendall(bytes([5, 1, 0]))
            assert client.recv(2) == bytes([5, 0])
            host = b"example.com"
            client.sendall(bytes([5, 1, 0, 3, len(host)]) + host + bytes([1, 187]))
            assert client.recv(10)[1] == 2, "Unrelated destination must be rejected before connecting"
        probe = helper.call("probe")
        assert probe["ok"] is True and probe["result"]["lastProbe"].startswith("GitHub HTTP 200"), probe
        invalid = helper.call("arbitrary-shell-command")
        assert invalid["ok"] is False and invalid["error"]
        assert helper.call("stop")["result"]["status"] == "disconnected"
        wait_stopped()
        assert helper.call("start")["result"]["status"] == "connected"
    finally:
        helper.close()
    wait_stopped()
    print("PASS status/start/PAC/SOCKS-domain-policy/probe-fixture/error/stop/restart/EOF")

    for port in (8868, 8869):
        with socket.socket() as occupied:
            occupied.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            occupied.bind(("127.0.0.1", port)); occupied.listen()
            helper = Helper(executable)
            try:
                result = helper.call("start")
                assert result["ok"] is False and result["result"]["status"] == "disconnected", result
                other = 8869 if port == 8868 else 8868
                assert unavailable(other), "Failed startup left a partial listener running"
            finally:
                helper.close()
        wait_stopped()
        print(f"PASS occupied-{port}-failure-and-partial-startup-rollback")

    helper = Helper(executable)
    assert helper.call("start")["result"]["status"] == "connected"
    helper.process.terminate()
    helper.process.wait(timeout=10)
    assert helper.process.returncode == 0, (helper.process.returncode, helper.process.stderr.read())
    wait_stopped()
    print("PASS SIGTERM cleanup")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: test-helper.py /path/to/DEBUG/easyhub-proxy-helper")
    run(pathlib.Path(sys.argv[1]).resolve())
