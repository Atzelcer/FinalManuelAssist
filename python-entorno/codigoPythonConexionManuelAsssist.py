"""
Manuel Assist - Teclado Humano WiFi UDP con Handshake

Uso:
  python teclado_humano_wifi.py

Flujo:
  1. ESP32 envía: MA_HELLO,IP_ESP32
  2. Python responde: MA_PC,IP_LAPTOP
  3. ESP32 guarda la IP de la laptop
  4. ESP32 envía:
       SYS:CALIBRANDO
       SYS:CALIBRACION_OK
       pulgar:activo
       pulgar:reposo

Controles:
  F5  -> activar escritura
  F6  -> pausar escritura
  ESC -> salir
"""

import socket
import time
import threading
from pynput.keyboard import Controller, Key, Listener as KbListener

# =====================================================
# CONFIG UDP
# =====================================================

UDP_IP = "0.0.0.0"
PC_PORT = 5005
ESP_PORT = 5006

CONFIRM_DELAY = 2.0

# =====================================================
# MAPEO DE LETRAS
# =====================================================

LETTER_MAP = {
    "pulgar":  ["a", "b", "c", "d", "e", "f"],
    "indice":  ["g", "h", "i", "j", "k", "l"],
    "medio":   ["m", "n", "ñ", "o", "p"],
    "anular":  ["q", "r", "s", "t", "u"],
    "menique": ["v", "w", "x", "y", "z"],
}

DEDOS_ORDEN = ["menique", "anular", "medio", "indice", "pulgar"]

# =====================================================
# TECLADO
# =====================================================

kb = Controller()

# =====================================================
# ESTADO GENERAL
# =====================================================

control_activo = False
salir = False

esp32_ip = None
pc_ip_local = None
ultimo_paquete = None

pending_finger = None
pending_count = 0
all_reposo_since = None

prev_states = {d: "reposo" for d in DEDOS_ORDEN}
curr_states = {d: "reposo" for d in DEDOS_ORDEN}

_lock = threading.Lock()


# =====================================================
# HANDSHAKE
# =====================================================

def obtener_ip_local_hacia(destino_ip):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((destino_ip, ESP_PORT))
        return s.getsockname()[0]
    finally:
        s.close()


def responder_a_esp32(sock, esp_ip):
    global pc_ip_local

    pc_ip_local = obtener_ip_local_hacia(esp_ip)

    msg = f"MA_PC,{pc_ip_local}"
    sock.sendto(msg.encode("utf-8"), (esp_ip, ESP_PORT))

    print()
    print("========== HANDSHAKE ==========")
    print(f"ESP32 detectado : {esp_ip}")
    print(f"Laptop IP       : {pc_ip_local}")
    print(f"Respuesta       : {msg}")
    print("================================")
    print()


# =====================================================
# ESCRITURA
# =====================================================

def escribir(letra):
    kb.type(letra)


def letra_pendiente():
    if pending_finger is None or pending_count == 0:
        return None

    letras = LETTER_MAP.get(pending_finger, [])

    if not letras:
        return None

    idx = (pending_count - 1) % len(letras)
    return letras[idx]


def confirmar():
    global pending_finger
    global pending_count
    global all_reposo_since

    letra = letra_pendiente()

    if letra:
        escribir(letra)
        print(f"\n[TECLADO] Confirmado: '{letra}'  ({pending_finger} x{pending_count})\n")

    pending_finger = None
    pending_count = 0
    all_reposo_since = None


def resetear_escritura():
    global pending_finger
    global pending_count
    global all_reposo_since

    pending_finger = None
    pending_count = 0
    all_reposo_since = None

    for d in DEDOS_ORDEN:
        curr_states[d] = "reposo"
        prev_states[d] = "reposo"


# =====================================================
# PROCESAMIENTO DE MENSAJES
# =====================================================

def procesar_sistema(msg):
    print(f"[SERIAL ESP32] {msg}")

    if msg == "PC_CONECTADA":
        print("[ESTADO] ESP32 guardó la IP de la laptop")

    elif "INICIANDO" in msg:
        print("[ESTADO] Iniciando sistema")

    elif "DETECTANDO" in msg:
        print("[ESTADO] Detectando MPU6050 en el TCA9548A")

    elif "CALIBRANDO" in msg:
        print("[ESTADO] Coloca la mano en reposo")

    elif "CALIBRACION_OK" in msg:
        print("[ESTADO] Calibración terminada")

    elif "SISTEMA_LISTO" in msg:
        print("[ESTADO] Sistema listo para usar")


def procesar_evento(dedo, estado):
    global pending_finger
    global pending_count
    global all_reposo_since

    dedo = dedo.strip().lower()
    estado = estado.strip().lower()

    if dedo not in LETTER_MAP:
        return

    if estado not in ["activo", "reposo"]:
        return

    print(f"[DATO] {dedo}:{estado}")

    curr_states[dedo] = estado

    if not control_activo:
        prev_states[dedo] = estado
        return

    prev = prev_states.get(dedo, "reposo")
    curr = curr_states.get(dedo, "reposo")

    rising = prev == "reposo" and curr == "activo"
    falling = prev == "activo" and curr == "reposo"

    prev_states[dedo] = curr

    if rising:
        all_reposo_since = None

        if pending_finger == dedo:
            pending_count += 1
        else:
            if pending_finger is not None:
                confirmar()

            pending_finger = dedo
            pending_count = 1

        letra = letra_pendiente()
        letras = LETTER_MAP[pending_finger]

        print(
            f"[SELECCION] {pending_finger} x{pending_count} -> '{letra}' "
            f"[{' '.join(letras)}]"
        )

    elif falling:
        if pending_finger == dedo:
            all_reposo_since = time.time()
            print(f"[REPOSO] Pendiente '{letra_pendiente()}' | esperando {CONFIRM_DELAY}s")


def revisar_confirmacion():
    global all_reposo_since

    if not control_activo:
        return

    if pending_finger is None:
        return

    if all_reposo_since is None:
        return

    algun_activo = any(curr_states[d] == "activo" for d in DEDOS_ORDEN)

    if algun_activo:
        all_reposo_since = None
        return

    if time.time() - all_reposo_since >= CONFIRM_DELAY:
        confirmar()


def parse_msg(msg):
    msg = msg.strip()

    if not msg:
        return ("EMPTY",)

    if msg.startswith("MA_HELLO,"):
        ip = msg.split(",", 1)[1].strip()
        return ("HELLO", ip)

    if msg.startswith("SYS:"):
        return ("SYS", msg[4:].strip())

    if ":" in msg:
        dedo, estado = msg.split(":", 1)
        return ("DATO", dedo.strip(), estado.strip())

    return ("RAW", msg)


# =====================================================
# CONTROLES DE TECLADO
# =====================================================

def imprimir_mapa():
    print()
    print("========= MAPEO =========")
    for dedo, letras in LETTER_MAP.items():
        fila = "  ".join(f"x{i+1}={l}" for i, l in enumerate(letras))
        print(f"{dedo:<8} {fila}")
    print("=========================")
    print()


def on_key_press(key):
    global control_activo
    global salir

    if key == Key.f5:
        with _lock:
            control_activo = True
            resetear_escritura()

        print("\n[CONTROL] TECLADO ACTIVO")
        imprimir_mapa()

    elif key == Key.f6:
        with _lock:
            control_activo = False
            resetear_escritura()

        print("\n[CONTROL] TECLADO PAUSADO")

    elif key == Key.esc:
        salir = True
        return False


# =====================================================
# MAIN
# =====================================================

def main():
    global salir
    global esp32_ip
    global ultimo_paquete

    print("======================================")
    print(" MANUEL ASSIST - WIFI UDP HANDSHAKE")
    print("======================================")
    print(f"Escuchando en UDP puerto {PC_PORT}")
    print("Esperando MA_HELLO del ESP32...")
    print("--------------------------------------")
    print("F5 activar escritura | F6 pausar | ESC salir")
    print("--------------------------------------")

    imprimir_mapa()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((UDP_IP, PC_PORT))
    sock.settimeout(0.05)

    KbListener(on_press=on_key_press).start()

    while not salir:
        try:
            try:
                data, addr = sock.recvfrom(1024)
                msg = data.decode("utf-8", errors="ignore").strip()
                ultimo_paquete = time.time()

                parsed = parse_msg(msg)

                with _lock:
                    tipo = parsed[0]

                    if tipo == "HELLO":
                        esp32_ip = parsed[1]
                        responder_a_esp32(sock, esp32_ip)

                    elif tipo == "SYS":
                        procesar_sistema(parsed[1])

                    elif tipo == "DATO":
                        _, dedo, estado = parsed
                        procesar_evento(dedo, estado)

                    elif tipo == "RAW":
                        print(f"[RAW] {parsed[1]}")

            except socket.timeout:
                pass

            with _lock:
                revisar_confirmacion()

            time.sleep(0.005)

        except KeyboardInterrupt:
            break

    sock.close()
    print("\nSaliendo...")


if __name__ == "__main__":
    main()