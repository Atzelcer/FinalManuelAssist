void detectarSensores() {
  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    sensorOK[i] = false;
    sensorAddr[i] = 0;
    resetearDedo(i);
    ultimoEstadoEnviado[i] = "";

    tcaSelect(canales[i]);
    delay(30);

    if (existsI2C(MPU_ADDR_1)) {
      sensorAddr[i] = MPU_ADDR_1;
      sensorOK[i] = configurarMPU(MPU_ADDR_1);
    } else if (existsI2C(MPU_ADDR_2)) {
      sensorAddr[i] = MPU_ADDR_2;
      sensorOK[i] = configurarMPU(MPU_ADDR_2);
    }

    enviarSistema(String("SENSOR_") + dedos[i] + (sensorOK[i] ? "_OK" : "_NO_DETECTADO"));
  }
}

bool calibrarDedoUnaVez(uint8_t i) {
  for (int w = 0; w < CAL_WARMUP; w++) {
    tcaSelect(canales[i]);
    delay(2);
    float ax, ay, az, gx, gy, gz;
    readMPU(sensorAddr[i], ax, ay, az, gx, gy, gz);
    delay(2);
  }

  float sumGX = 0, sumGY = 0, sumGZ = 0;
  float sumGX2 = 0, sumGY2 = 0, sumGZ2 = 0;
  float sumAXang = 0, sumAYang = 0;
  int validas = 0;

  for (int m = 0; m < CAL_MUESTRAS; m++) {
    tcaSelect(canales[i]);
    delay(2);

    float ax, ay, az, gx, gy, gz;
    if (readMPU(sensorAddr[i], ax, ay, az, gx, gy, gz)) {
      float accelAngleX = atan2(ay, az) * 180.0 / PI;
      float accelAngleY = atan2(-ax, sqrt((ay * ay) + (az * az))) * 180.0 / PI;

      sumGX += gx;  sumGY += gy;  sumGZ += gz;
      sumGX2 += gx * gx;  sumGY2 += gy * gy;  sumGZ2 += gz * gz;
      sumAXang += accelAngleX;
      sumAYang += accelAngleY;
      validas++;
    }

    delay(3);
  }

  if (validas < 10) return false;

  float mGX = sumGX / validas;
  float mGY = sumGY / validas;
  float mGZ = sumGZ / validas;

  float varGX = (sumGX2 / validas) - (mGX * mGX);
  float varGY = (sumGY2 / validas) - (mGY * mGY);
  float varGZ = (sumGZ2 / validas) - (mGZ * mGZ);
  if (varGX < 0) varGX = 0;
  if (varGY < 0) varGY = 0;
  if (varGZ < 0) varGZ = 0;

  float stdMax = sqrt(varGX);
  if (sqrt(varGY) > stdMax) stdMax = sqrt(varGY);
  if (sqrt(varGZ) > stdMax) stdMax = sqrt(varGZ);

  gyroOffsetX[i] = mGX;
  gyroOffsetY[i] = mGY;
  gyroOffsetZ[i] = mGZ;
  neutralAngleX[i] = sumAXang / validas;
  neutralAngleY[i] = sumAYang / validas;

  return (stdMax <= CAL_MAX_STD_GYRO);
}

void calibrarSensores() {
  sensoresCalibrados = false;
  envioDatosHabilitado = false;
  enviarSistema("CALIBRANDO");
  enviarCalibracionProgreso(0, NUM_SENSORES);
  delay(1200);

  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    gyroOffsetX[i] = 0;
    gyroOffsetY[i] = 0;
    gyroOffsetZ[i] = 0;
    neutralAngleX[i] = 0;
    neutralAngleY[i] = 0;
    resetearDedo(i);

    if (sensorOK[i]) {
      bool quieto = false;
      int intento = 0;

      while (!quieto && intento < CAL_MAX_INTENTOS) {
        intento++;
        quieto = calibrarDedoUnaVez(i);
        if (!quieto) {
          enviarSistema(String("MOVIMIENTO_EN_") + dedos[i] + "_REINTENTO_" + intento);
          delay(400);
        }
      }

      if (!quieto) {
        enviarSistema(String("AVISO_") + dedos[i] + "_MOVIMIENTO_RESIDUAL");
      }
    }

    enviarCalibracionProgreso(i + 1, NUM_SENSORES);
  }

  enviarSistema("CALIBRACION_OK");
}
