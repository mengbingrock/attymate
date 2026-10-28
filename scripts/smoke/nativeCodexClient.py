"""Attach an actual Codex terminal client to a smoke-owned server using a private PTY."""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

binary, endpoint, project, expected = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(project)
    os.environ["TERM"] = "xterm-256color"
    os.execv(binary, [binary, "agents", "--remote", endpoint, "--cd", project])

output = b""
matched = False
try:
    fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 120, 0, 0))
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                chunk = os.read(fd, 65536)
            except BlockingIOError:
                continue
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            # Respond to the terminal cursor-position query without injecting a prompt.
            if b"\x1b[6n" in chunk:
                try:
                    os.write(fd, b"\x1b[1;1R")
                except BlockingIOError:
                    pass
            if expected in output.decode("utf-8", errors="replace"):
                matched = True
                break
    print(json.dumps({"attached": matched, "expectedThreadLabel": expected}), flush=True)
    if not matched:
        print(output.decode("utf-8", errors="replace")[-3000:], file=sys.stderr)
        sys.exit(1)
finally:
    try:
        os.write(fd, b"\x03")
    except OSError:
        pass
    # Keep draining terminal output while the client restores its screen. A full PTY buffer
    # can otherwise hold its shutdown path open after the attachment assertion has passed.
    def reap_until(timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    os.read(fd, 65536)
                except OSError:
                    pass
            if os.waitpid(pid, os.WNOHANG)[0]:
                return True
        return False

    exited = reap_until(3)
    if not exited:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        exited = reap_until(3)
    if not exited:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if not reap_until(3):
            raise RuntimeError("Smoke-owned terminal client did not exit: " + str(pid))
    os.close(fd)
