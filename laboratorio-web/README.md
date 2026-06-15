# Manuel Assist Lab

Laboratorio web para probar el modelo 3D del brazo, mover dedos manualmente y recibir eventos del ESP32.

## Modelo revisado

El archivo `modelo3D-brazo/source/MyRiggedArms2.fbx` contiene huesos `LimbNode` para ambas manos. Cada dedo tiene tres falanges y un hueso terminal:

- `thumb_01/02/03_l` y `thumb_01/02/03_r`
- `index_01/02/03_l` y `index_01/02/03_r`
- `middle_01/02/03_l` y `middle_01/02/03_r`
- `ring_01/02/03_l` y `ring_01/02/03_r`
- `pinky_01/02/03_l` y `pinky_01/02/03_r`

La jerarquia detectada es correcta para control por falanges: `hand_* -> dedo_01_* -> dedo_02_* -> dedo_03_* -> dedo_03_*_end`.

## Ejecutar

Desde la carpeta raiz:

```powershell
& "C:\Users\atzel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 8080
```

Luego abrir:

```text
http://localhost:8080/laboratorio-web/
```

## Conexion ESP32

- `Serial USB` usa Web Serial API y espera lineas como `pulgar:activo` o `pulgar : activo`.
- `WebSocket` queda preparado para un puente local `ws://localhost:8765`.
- Un navegador no puede escuchar UDP directo. Para el flujo WiFi UDP actual hace falta un puente Python UDP -> WebSocket, o cambiar el ESP32 para enviar WebSocket/HTTP.

## Flujo recomendado actual

1. Configurar `WIFI_SSID` y `WIFI_PASS` en `hardware-firdware/ManuelAssistGlove/ManuelAssistGlove.ino`.
2. Subir el firmware al ESP32.
3. Ejecutar el puente:

```powershell
& "C:\Users\atzel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" python-entorno\laboratorio_bridge.py
```

4. Abrir el laboratorio y pulsar `WebSocket`.
5. Pulsar `Calibrar`; el puente envia `CMD:CALIBRATE` al ESP32 y muestra progreso.
6. Pulsar `Iniciar`; Python habilita la escritura y controla modos.

## Reglas de modo

- ESP32 solo detecta `reposo` y `activo` por dedo y envia eventos UDP.
- Python espera que todos los dedos esten en reposo antes de abrir una ventana de decision.
- Si en esa ventana detecta 4 o mas dedos activos, cambia modo: letras -> numeros -> cursor -> letras.
- Si en esa ventana detecta un solo dedo, bloquea la seleccion a ese dedo.
- Si se levanta otro dedo mientras hay una tecla pendiente, Python confirma la anterior y comienza la nueva.
- Si todos vuelven a reposo durante `2s`, Python confirma la tecla pendiente.
