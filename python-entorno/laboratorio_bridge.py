"""
Manuel Assist Lab Bridge

Responsabilidades:
- Recibir UDP desde ESP32 en puerto 5005.
- Responder handshake hacia ESP32 en puerto 5006.
- Enviar comandos UDP al ESP32: calibrar, ping.
- Exponer WebSocket local ws://localhost:8765 para el laboratorio web.
- Procesar modos letras/numeros/cursor y seleccion de teclas.
"""

import base64
import hashlib
import json
import sys
import socket
import struct
import threading
import time

try:
    from pynput.keyboard import Controller, Key
except Exception:
    Controller = None
    Key = None

try:
    from pynput.mouse import Button, Controller as MouseController
except Exception:
    Button = None
    MouseController = None


UDP_IP = "0.0.0.0"
PC_PORT = 5005
ESP_PORT = 5006
WS_HOST = "127.0.0.1"
WS_PORT = 8765

CONFIRM_DELAY = 2.0
VISUAL_ACTIVE_SECONDS = 0.8
REST_ARM_SECONDS = 0.55
MODE_WINDOW_SECONDS = 0.35
MODE_CHANGE_MIN_ACTIVE = 4

DEDOS_ORDEN = ["menique", "anular", "medio", "indice", "pulgar"]
MODES = ["letters", "numbers", "cursor"]

LETTER_MAP = {
    "pulgar": ["a", "b", "c", "d", "e", "f"],
    "indice": ["g", "h", "i", "j", "k", "l"],
    "medio": ["m", "n", "ñ", "o", "p"],
    "anular": ["q", "r", "s", "t", "u"],
    "menique": ["v", "w", "x", "y", "z"],
}

NUMBER_MAP = {
    "pulgar": ["1", "2", "+"],
    "indice": ["3", "4", "-"],
    "medio": ["5", "6", "*"],
    "anular": ["7", "8", "/"],
    "menique": ["9", "0", ".", ";"],
}

CURSOR_MAP = {
    "pulgar": ["windows"],
    "indice": ["cursor_gyro"],
    "medio": ["clear"],
    "anular": ["left_click"],
    "menique": ["right_click"],
}

MOUSE_DEADZONE = 0.6
MOUSE_GAIN = 2.2
MOUSE_TILT_GAIN = 1.35
MOUSE_MAX_STEP = 180
CURSOR_REST_SETTLE_SECONDS = 0.28


class WebSocketHub:
    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def add(self, conn):
        with self.lock:
            self.clients.add(conn)

    def remove(self, conn):
        with self.lock:
            self.clients.discard(conn)

    def broadcast(self, payload):
        data = json.dumps(payload, ensure_ascii=False)
        dead = []
        with self.lock:
            clients = list(self.clients)
        for conn in clients:
            try:
                ws_send(conn, data)
            except OSError:
                dead.append(conn)
        for conn in dead:
            self.remove(conn)


class LabState:
    def __init__(self, hub):
        self.hub = hub
        self.lock = threading.Lock()
        self.mode = "letters"
        self.enabled = False
        self.curr_states = {d: "reposo" for d in DEDOS_ORDEN}
        self.prev_states = {d: "reposo" for d in DEDOS_ORDEN}
        self.pending_finger = None
        self.pending_count = 0
        self.pending_started_at = 0.0
        self.visual_release_at = 0.0
        self.confirm_at = 0.0
        self.visual_released = True
        self.all_reposo_since = time.time()
        self.mode_window_until = 0.0
        self.mode_window_seen = set()
        self.locked_finger = None
        self.waiting_for_rest = False
        self.esp32_ip = None
        self.pc_ip_local = None
        self.keyboard = Controller() if Controller else None
        self.mouse = MouseController() if MouseController else None
        self.cursor_gyro_enabled = False
        self.cursor_rest_candidate_at = 0.0
        self.last_imu_at = 0.0

    def publish(self, payload):
        self.hub.broadcast(payload)

    def set_enabled(self, enabled):
        with self.lock:
            self.enabled = enabled
            self.reset_selection()
        self.publish({"type": "enabled", "enabled": enabled})

    def reset_selection(self):
        self.pending_finger = None
        self.pending_count = 0
        self.pending_started_at = 0.0
        self.visual_release_at = 0.0
        self.confirm_at = 0.0
        self.visual_released = True
        self.locked_finger = None
        self.waiting_for_rest = False
        self.cursor_gyro_enabled = False
        self.cursor_rest_candidate_at = 0.0
        self.mode_window_until = 0.0
        self.mode_window_seen.clear()

    def forget_connection(self):
        with self.lock:
            self.enabled = False
            self.reset_selection()
            self.esp32_ip = None
            self.pc_ip_local = None
            for d in DEDOS_ORDEN:
                self.curr_states[d] = "reposo"
                self.prev_states[d] = "reposo"
        self.publish({"type": "enabled", "enabled": False})
        self.publish({"type": "connected", "esp32_ip": None, "pc_ip": None})

    def cycle_mode(self):
        idx = MODES.index(self.mode)
        self.mode = MODES[(idx + 1) % len(MODES)]
        self.reset_selection()
        self.waiting_for_rest = not self.all_resting()
        for finger in DEDOS_ORDEN:
            self.publish({"type": "finger", "finger": finger, "status": "reposo"})
        self.publish({"type": "mode", "mode": self.mode})
        try:
            send_mode_to_esp()
        except Exception:
            pass

    def active_count(self):
        return sum(1 for d in DEDOS_ORDEN if self.curr_states[d] == "activo")

    def all_resting(self):
        return all(self.curr_states[d] == "reposo" for d in DEDOS_ORDEN)

    def map_for_mode(self):
        if self.mode == "numbers":
            return NUMBER_MAP
        if self.mode == "cursor":
            return CURSOR_MAP
        return LETTER_MAP

    def pending_key(self):
        if not self.pending_finger or self.pending_count <= 0:
            return None
        options = self.map_for_mode().get(self.pending_finger, [])
        if not options:
            return None
        return options[(self.pending_count - 1) % len(options)]

    def press_windows_key(self):
        if sys.platform.startswith("win"):
            try:
                import ctypes
                user32 = ctypes.windll.user32
                vk_lwin = 0x5B
                key_up = 0x0002
                user32.keybd_event(vk_lwin, 0, 0, 0)
                user32.keybd_event(vk_lwin, 0, key_up, 0)
                return
            except Exception as exc:
                self.publish({"type": "error", "message": f"windows: {exc}"})

        win_key = getattr(Key, "cmd", None) or getattr(Key, "cmd_l", None) if Key else None
        if self.keyboard and win_key:
            self.keyboard.press(win_key)
            self.keyboard.release(win_key)

    def clear_text_target(self):
        if not self.keyboard or not Key:
            return
        ctrl_key = getattr(Key, "ctrl", None) or getattr(Key, "ctrl_l", None)
        if not ctrl_key:
            return
        self.keyboard.press(ctrl_key)
        self.keyboard.press("a")
        self.keyboard.release("a")
        self.keyboard.release(ctrl_key)
        self.keyboard.press(Key.backspace)
        self.keyboard.release(Key.backspace)

    def emit_key(self, key):
        if not key:
            return
        self.publish({"type": "confirm", "key": key, "mode": self.mode})
        try:
            if self.mode == "cursor":
                special = {} if not Key else {
                    "space": Key.space,
                    "enter": Key.enter,
                    "right": Key.right,
                    "left": Key.left,
                    "up": Key.up,
                    "down": Key.down,
                    "backspace": Key.backspace,
                    "tab": Key.tab,
                    "escape": Key.esc,
                }
                if key == "mode":
                    self.cycle_mode()
                elif key == "windows":
                    self.press_windows_key()
                elif key == "clear":
                    self.clear_text_target()
                elif key in special:
                    if self.keyboard:
                        self.keyboard.press(special[key])
                        self.keyboard.release(special[key])
                elif key == "left_click" and self.mouse and Button:
                    self.mouse.click(Button.left, 1)
                elif key == "right_click" and self.mouse and Button:
                    self.mouse.click(Button.right, 1)
            else:
                if not self.keyboard:
                    return
                self.keyboard.type(key)
        except Exception as exc:
            self.publish({"type": "error", "message": f"teclado: {exc}"})

    def confirm(self):
        key = self.pending_key()
        finger = self.pending_finger
        self.emit_key(key)
        self.reset_selection()
        if finger:
            self.publish({"type": "finger", "finger": finger, "status": "reposo"})
        for d in DEDOS_ORDEN:
            self.curr_states[d] = "reposo"
            self.prev_states[d] = "reposo"
        self.all_reposo_since = time.time()

    def begin_selection(self, finger, now=None):
        now = now or time.time()
        self.locked_finger = finger
        if self.pending_finger == finger:
            self.pending_count += 1
        else:
            self.pending_finger = finger
            self.pending_count = 1
        self.pending_started_at = now
        self.visual_release_at = now + VISUAL_ACTIVE_SECONDS
        self.confirm_at = now + CONFIRM_DELAY
        self.visual_released = False
        self.publish({"type": "finger", "finger": finger, "status": "activo"})
        self.publish({
            "type": "preview",
            "finger": finger,
            "count": self.pending_count,
            "key": self.pending_key(),
            "mode": self.mode,
        })

    def resolve_mode_window_if_expired(self, now):
        if self.mode_window_until == 0.0 or now <= self.mode_window_until:
            return False

        seen = set(self.mode_window_seen)
        self.mode_window_until = 0.0
        self.mode_window_seen.clear()

        if len(seen) >= MODE_CHANGE_MIN_ACTIVE:
            self.cycle_mode()
            return True

        if len(seen) == 1:
            self.begin_selection(next(iter(seen)), now)
            return True

        return False

    def handle_finger(self, finger, status):
        now = time.time()
        with self.lock:
            if finger not in self.curr_states or status not in ("activo", "reposo"):
                return

            if self.mode == "cursor" and self.cursor_gyro_enabled and finger != "indice":
                return

            if self.pending_finger and now >= self.confirm_at:
                self.confirm()

            prev = self.prev_states.get(finger, "reposo")
            self.curr_states[finger] = status
            rising = prev == "reposo" and status == "activo"
            self.prev_states[finger] = status

            if self.mode == "cursor" and finger == "indice":
                if status == "activo":
                    self.reset_selection()
                    self.cursor_gyro_enabled = True
                    self.cursor_rest_candidate_at = 0.0
                    self.publish({"type": "finger", "finger": finger, "status": "activo"})
                else:
                    self.cursor_rest_candidate_at = now
                return

            if self.waiting_for_rest:
                if self.all_resting():
                    self.waiting_for_rest = False
                    self.all_reposo_since = now
                    self.locked_finger = None
                return

            if self.pending_finger:
                if self.mode_window_until > 0.0 and now <= self.mode_window_until and rising:
                    self.mode_window_seen.add(finger)
                    if len(self.mode_window_seen) >= MODE_CHANGE_MIN_ACTIVE:
                        self.cycle_mode()
                        return
                if rising and finger == self.pending_finger:
                    self.begin_selection(finger, now)
                return

            if self.all_resting():
                self.all_reposo_since = now
                self.locked_finger = None
                self.publish({"type": "finger", "finger": finger, "status": status})
                return

            if not self.enabled:
                self.publish({"type": "finger", "finger": finger, "status": status})
                return

            armed_for_mode = now - self.all_reposo_since >= REST_ARM_SECONDS
            if rising and armed_for_mode:
                self.mode_window_until = now + MODE_WINDOW_SECONDS
                self.mode_window_seen = {finger}

            if self.locked_finger and finger != self.locked_finger:
                return

            if rising:
                self.begin_selection(finger, now)

    def tick(self):
        with self.lock:
            if not self.enabled:
                return
            now = time.time()
            if self.waiting_for_rest:
                if self.all_resting():
                    self.waiting_for_rest = False
                    self.all_reposo_since = now
                return
            if self.pending_finger:
                if self.mode_window_until > 0.0 and now > self.mode_window_until:
                    self.mode_window_until = 0.0
                    self.mode_window_seen.clear()
                if not self.visual_released and now >= self.visual_release_at:
                    self.publish({"type": "finger", "finger": self.pending_finger, "status": "reposo"})
                    self.visual_released = True
                if now >= self.confirm_at:
                    self.confirm()
                return
            self.resolve_mode_window_if_expired(now)

            if self.cursor_gyro_enabled and self.cursor_rest_candidate_at:
                if now - self.cursor_rest_candidate_at >= CURSOR_REST_SETTLE_SECONDS:
                    self.cursor_gyro_enabled = False
                    self.cursor_rest_candidate_at = 0.0
                    self.publish({"type": "finger", "finger": "indice", "status": "reposo"})

    def handle_imu(self, finger, angle_x, angle_y, gyro_x, gyro_y, status):
        if not self.enabled or self.mode != "cursor" or finger != "indice":
            return
        if status == "activo":
            self.cursor_gyro_enabled = True
            self.cursor_rest_candidate_at = 0.0
        if not self.cursor_gyro_enabled or not self.mouse:
            return

        raw_dx = (gyro_y * MOUSE_GAIN) + (angle_y * MOUSE_TILT_GAIN)
        raw_dy = (-gyro_x * MOUSE_GAIN) - (angle_x * MOUSE_TILT_GAIN)
        movement = max(abs(raw_dx), abs(raw_dy))
        now = time.time()

        if status == "reposo":
            if movement < MOUSE_DEADZONE:
                if self.cursor_rest_candidate_at == 0.0:
                    self.cursor_rest_candidate_at = now
                if now - self.cursor_rest_candidate_at >= CURSOR_REST_SETTLE_SECONDS:
                    self.cursor_gyro_enabled = False
                    self.cursor_rest_candidate_at = 0.0
                    self.publish({"type": "finger", "finger": "indice", "status": "reposo"})
                    return
            else:
                self.cursor_rest_candidate_at = 0.0

        if now - self.last_imu_at < 0.006:
            return
        self.last_imu_at = now

        dx = 0.0 if abs(raw_dx) < MOUSE_DEADZONE else raw_dx
        dy = 0.0 if abs(raw_dy) < MOUSE_DEADZONE else raw_dy
        dx = max(-MOUSE_MAX_STEP, min(MOUSE_MAX_STEP, dx))
        dy = max(-MOUSE_MAX_STEP, min(MOUSE_MAX_STEP, dy))
        if abs(dx) < 0.5 and abs(dy) < 0.5:
            return

        try:
            self.mouse.move(int(dx), int(dy))
            self.publish({
                "type": "cursor",
                "finger": finger,
                "dx": int(dx),
                "dy": int(dy),
                "angle_x": round(angle_x, 2),
                "angle_y": round(angle_y, 2),
            })
        except Exception as exc:
            self.publish({"type": "error", "message": f"mouse: {exc}"})


hub = WebSocketHub()
state = LabState(hub)
udp_sock = None


def obtener_ip_local_hacia(destino_ip):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((destino_ip, ESP_PORT))
        return s.getsockname()[0]
    finally:
        s.close()


def send_udp(msg):
    if not state.esp32_ip:
        state.publish({"type": "error", "message": "ESP32 no conectado"})
        return
    udp_sock.sendto(msg.encode("utf-8"), (state.esp32_ip, ESP_PORT))


def send_mode_to_esp():
    if not state.esp32_ip:
        return
    send_udp(f"CMD:MODE,{state.mode}")


def parse_udp(msg):
    msg = msg.strip()
    if not msg:
        return
    if msg.startswith("MA_HELLO,"):
        ip = msg.split(",", 1)[1].strip()
        state.esp32_ip = ip
        state.pc_ip_local = obtener_ip_local_hacia(ip)
        response = f"MA_PC,{state.pc_ip_local}"
        udp_sock.sendto(response.encode("utf-8"), (ip, ESP_PORT))
        state.publish({"type": "connected", "esp32_ip": ip, "pc_ip": state.pc_ip_local})
        return
    if msg.startswith("SYS:"):
        system_msg = msg[4:].strip()
        if system_msg == "STREAM_ACTIVO":
            state.set_enabled(True)
        elif system_msg in ("STREAM_PAUSADO", "ERROR_NO_CALIBRADO", "DESCONECTANDO"):
            state.set_enabled(False)
        state.publish({"type": "system", "message": system_msg})
        return
    if msg.startswith("CAL:"):
        body = msg[4:].strip()
        try:
            current, total = [int(x) for x in body.split("/", 1)]
            pct = int((current / max(total, 1)) * 100)
        except Exception:
            current, total, pct = 0, 0, 0
        state.publish({"type": "calibration", "current": current, "total": total, "percent": pct})
        return
    if msg.startswith("IMU:"):
        parts = [part.strip() for part in msg[4:].split(",")]
        if len(parts) >= 6:
            try:
                finger = parts[0].lower()
                angle_x = float(parts[1])
                angle_y = float(parts[2])
                gyro_x = float(parts[3])
                gyro_y = float(parts[4])
                status = parts[5].lower()
                state.handle_imu(finger, angle_x, angle_y, gyro_x, gyro_y, status)
            except Exception as exc:
                state.publish({"type": "error", "message": f"imu: {exc}"})
        return
    if ":" in msg:
        finger, status = [part.strip().lower() for part in msg.split(":", 1)]
        state.handle_finger(finger, status)


def udp_loop():
    global udp_sock
    udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    udp_sock.bind((UDP_IP, PC_PORT))
    udp_sock.settimeout(0.05)
    while True:
        try:
            data, _addr = udp_sock.recvfrom(1024)
            parse_udp(data.decode("utf-8", errors="ignore"))
        except socket.timeout:
            pass
        state.tick()
        time.sleep(0.005)


def ws_send(conn, text):
    payload = text.encode("utf-8")
    if len(payload) < 126:
        header = bytes([0x81, len(payload)])
    elif len(payload) < 65536:
        header = bytes([0x81, 126]) + struct.pack("!H", len(payload))
    else:
        header = bytes([0x81, 127]) + struct.pack("!Q", len(payload))
    conn.sendall(header + payload)


def ws_recv(conn):
    header = conn.recv(2)
    if len(header) < 2:
        return None
    _fin_opcode, length_byte = header
    masked = length_byte & 0x80
    length = length_byte & 0x7F
    if length == 126:
        length = struct.unpack("!H", conn.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", conn.recv(8))[0]
    mask = conn.recv(4) if masked else b""
    data = conn.recv(length)
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return data.decode("utf-8", errors="ignore")


def handle_ws_message(raw):
    try:
        msg = json.loads(raw)
    except Exception:
        return
    action = msg.get("action")
    if action == "start":
        send_udp("CMD:START_STREAM")
        send_mode_to_esp()
    elif action == "stop":
        send_udp("CMD:STOP_STREAM")
        state.set_enabled(False)
    elif action == "disconnect":
        send_udp("CMD:DISCONNECT")
        state.forget_connection()
    elif action == "calibrate":
        state.publish({"type": "calibration", "current": 0, "total": 5, "percent": 0})
        send_udp("CMD:CALIBRATE")
    elif action == "ping":
        send_udp("CMD:PING")
    elif action == "mode":
        mode = msg.get("mode")
        if mode in MODES:
            state.mode = mode
            state.reset_selection()
            state.publish({"type": "mode", "mode": mode})
            send_mode_to_esp()


def ws_client(conn):
    hub.add(conn)
    try:
        ws_send(conn, json.dumps({
            "type": "hello",
            "mode": state.mode,
            "enabled": state.enabled,
            "esp32_ip": state.esp32_ip,
        }))
        while True:
            raw = ws_recv(conn)
            if raw is None:
                break
            handle_ws_message(raw)
    finally:
        hub.remove(conn)
        conn.close()


def websocket_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((WS_HOST, WS_PORT))
    server.listen(8)
    while True:
        conn, _addr = server.accept()
        request = conn.recv(4096).decode("utf-8", errors="ignore")
        key = ""
        for line in request.splitlines():
            if line.lower().startswith("sec-websocket-key:"):
                key = line.split(":", 1)[1].strip()
                break
        if not key:
            conn.close()
            continue
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        conn.sendall(response.encode("utf-8"))
        threading.Thread(target=ws_client, args=(conn,), daemon=True).start()


def main():
    print("Manuel Assist Lab Bridge")
    print(f"UDP ESP32 -> PC: {PC_PORT}")
    print(f"WebSocket laboratorio: ws://{WS_HOST}:{WS_PORT}")
    threading.Thread(target=udp_loop, daemon=True).start()
    websocket_server()


if __name__ == "__main__":
    main()
