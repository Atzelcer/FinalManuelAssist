#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <math.h>

#define SDA_PIN 21
#define SCL_PIN 22

#define TCA_ADDR 0x70
#define MPU_ADDR_1 0x68
#define MPU_ADDR_2 0x69

#define REG_PWR_MGMT_1    0x6B
#define REG_SMPLRT_DIV    0x19
#define REG_CONFIG        0x1A
#define REG_GYRO_CONFIG   0x1B
#define REG_ACCEL_CONFIG  0x1C
#define REG_ACCEL_XOUT_H  0x3B

#define WIFI_SSID "ModoB"
#define WIFI_PASS "1234567899"

const uint16_t PC_PORT = 5005;
const uint16_t ESP_PORT = 5006;
const uint8_t NUM_SENSORES = 5;

const uint8_t canales[NUM_SENSORES] = {2, 3, 4, 5, 6};
const char* dedos[NUM_SENSORES] = {
  "menique",
  "anular",
  "medio",
  "indice",
  "pulgar"
};

const uint8_t MENIQUE = 0;
const uint8_t ANULAR  = 1;
const uint8_t MEDIO   = 2;
const uint8_t INDICE  = 3;
const uint8_t PULGAR  = 4;

bool sensorOK[NUM_SENSORES];
uint8_t sensorAddr[NUM_SENSORES];

float gyroOffsetX[NUM_SENSORES];
float gyroOffsetY[NUM_SENSORES];
float gyroOffsetZ[NUM_SENSORES];

float neutralAngleX[NUM_SENSORES];
float neutralAngleY[NUM_SENSORES];

float angleX[NUM_SENSORES];
float angleY[NUM_SENSORES];
float angleXFilt[NUM_SENSORES];
float angleYFilt[NUM_SENSORES];

String estadoTemporal[NUM_SENSORES];
String estadoConfirmado[NUM_SENSORES];
String ultimoEstadoEnviado[NUM_SENSORES];
bool pulsoActivoEnviado[NUM_SENSORES];
bool pulsoReposoForzado[NUM_SENSORES];
unsigned long pulsoActivoDesde[NUM_SENSORES];

uint8_t contadorEstable[NUM_SENSORES];
unsigned long lastTime = 0;

bool calibracionPendiente = false;
bool sensoresCalibrados = false;
bool envioDatosHabilitado = false;

const float ALPHA_ANGLE = 0.28;
const float DEADZONE_GYRO = 2.0;
const float COMPLEMENTARY = 0.96;

float ACTIVAR_ON[NUM_SENSORES] = {
  6.0,    // meñique
  1.8,    // anular
  6.0,    // medio
  14.0,   // índice
  14.0    // pulgar
};

float ACTIVAR_OFF[NUM_SENSORES] = {
  3.8,    // meñique
  0.5,    // anular
  3.0,    // medio
  7.0,    // índice
  7.0     // pulgar
};

const uint8_t FRAMES_CONFIRMACION = 2;
const uint8_t FRAMES_REPOSO_RAPIDO = 1;
const unsigned long PULSO_ACTIVO_MS = 800;

const int   CAL_WARMUP       = 80;
const int   CAL_MUESTRAS     = 500;
const int   CAL_MAX_INTENTOS = 4;
const float CAL_MAX_STD_GYRO = 3.0;

void iniciarRed();
void procesarRed();
void enviarSistema(const String &msg);
void enviarDato(const String &dedo, const String &estado);
void enviarCalibracionProgreso(uint8_t actual, uint8_t total);
void olvidarConexion();

void tcaSelect(uint8_t channel);
bool existsI2C(uint8_t addr);

bool writeByte(uint8_t addr, uint8_t reg, uint8_t val);
int16_t to16(uint8_t h, uint8_t l);
bool read14(uint8_t addr, uint8_t* buf);
bool readMPU(uint8_t addr, float &ax, float &ay, float &az, float &gx, float &gy, float &gz);
bool configurarMPU(uint8_t addr);
float deadzone(float v);

void resetearDedo(uint8_t i);
String clasificarMovimiento(uint8_t i);
void confirmarEstado(uint8_t i, String nuevoEstado);

void detectarSensores();
bool calibrarDedoUnaVez(uint8_t i);
void calibrarSensores();

void actualizarDedo(uint8_t i, float dt);
void enviarCambios();

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  iniciarRed();

  enviarSistema("DETECTANDO");
  detectarSensores();
  enviarSistema("SISTEMA_LISTO_SIN_CALIBRAR");

  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    ultimoEstadoEnviado[i] = "";
    pulsoActivoEnviado[i] = false;
    pulsoReposoForzado[i] = false;
    pulsoActivoDesde[i] = 0;
  }

  lastTime = millis();
}

void loop() {
  procesarRed();

  if (calibracionPendiente) {
    calibracionPendiente = false;
    envioDatosHabilitado = false;
    calibrarSensores();
    sensoresCalibrados = true;
  }

  unsigned long now = millis();
  float dt = (now - lastTime) / 1000.0;
  lastTime = now;

  if (dt <= 0 || dt > 0.15) {
    dt = 0.02;
  }

  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    actualizarDedo(i, dt);
  }

  if (sensoresCalibrados && envioDatosHabilitado) {
    enviarCambios();
  }
  delay(6);
}
