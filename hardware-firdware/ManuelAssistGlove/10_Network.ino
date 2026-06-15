WiFiUDP udp;
IPAddress pcIp;
bool pcConectada = false;
unsigned long ultimoHello = 0;

void enviarUDP(const String &msg, IPAddress ip, uint16_t port) {
  udp.beginPacket(ip, port);
  udp.write((const uint8_t*)msg.c_str(), msg.length());
  udp.endPacket();
  Serial.println(msg);
}

void enviarAPC(const String &msg) {
  if (pcConectada) {
    enviarUDP(msg, pcIp, PC_PORT);
  } else {
    Serial.println(msg);
  }
}

void iniciarRed() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("SYS:WIFI_CONECTANDO");
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 12000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    udp.begin(ESP_PORT);
    enviarSistema("WIFI_OK," + WiFi.localIP().toString());
  } else {
    enviarSistema("WIFI_ERROR");
  }
}

void enviarHello() {
  if (WiFi.status() != WL_CONNECTED) return;
  String msg = "MA_HELLO," + WiFi.localIP().toString();
  enviarUDP(msg, IPAddress(255, 255, 255, 255), PC_PORT);
}

void procesarRed() {
  if (WiFi.status() == WL_CONNECTED && !pcConectada && millis() - ultimoHello > 1000) {
    ultimoHello = millis();
    enviarHello();
  }

  int packetSize = udp.parsePacket();
  if (!packetSize) return;

  char buffer[128];
  int len = udp.read(buffer, sizeof(buffer) - 1);
  if (len <= 0) return;
  buffer[len] = '\0';

  String msg = String(buffer);
  msg.trim();

  if (msg.startsWith("MA_PC,")) {
    pcIp = udp.remoteIP();
    pcConectada = true;
    envioDatosHabilitado = false;
    modoComplementos = false;
    enviarSistema("PC_CONECTADA");
    return;
  }

  if (msg == "CMD:CALIBRATE") {
    calibracionPendiente = true;
    enviarSistema("CALIBRACION_SOLICITADA");
    return;
  }

  if (msg == "CMD:START_STREAM") {
    if (sensoresCalibrados) {
      envioDatosHabilitado = true;
      ultimoEnvioImu = 0;
      for (uint8_t i = 0; i < NUM_SENSORES; i++) {
        ultimoEstadoEnviado[i] = "";
        pulsoActivoEnviado[i] = false;
        pulsoReposoForzado[i] = false;
        pulsoActivoDesde[i] = 0;
      }
      enviarSistema("STREAM_ACTIVO");
    } else {
      enviarSistema("ERROR_NO_CALIBRADO");
    }
    return;
  }

  if (msg.startsWith("CMD:MODE,")) {
    String modo = msg.substring(9);
    modo.trim();
    modoComplementos = (modo == "cursor");
    enviarSistema("MODO_" + modo);
    return;
  }

  if (msg == "CMD:STOP_STREAM") {
    envioDatosHabilitado = false;
    enviarSistema("STREAM_PAUSADO");
    return;
  }

  if (msg == "CMD:DISCONNECT") {
    enviarSistema("DESCONECTANDO");
    olvidarConexion();
    return;
  }

  if (msg == "CMD:PING") {
    enviarSistema("PONG");
  }
}

void olvidarConexion() {
  envioDatosHabilitado = false;
  modoComplementos = false;
  ultimoEnvioImu = 0;
  pcConectada = false;
  pcIp = IPAddress(0, 0, 0, 0);
  ultimoHello = 0;
  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    ultimoEstadoEnviado[i] = "";
    pulsoActivoEnviado[i] = false;
    pulsoReposoForzado[i] = false;
    pulsoActivoDesde[i] = 0;
  }
  Serial.println("SYS:CONEXION_CERRADA");
}

void enviarSistema(const String &msg) {
  enviarAPC("SYS:" + msg);
}

void enviarDato(const String &dedo, const String &estado) {
  enviarAPC(dedo + ":" + estado);
}

void enviarCalibracionProgreso(uint8_t actual, uint8_t total) {
  enviarAPC("CAL:" + String(actual) + "/" + String(total));
}
