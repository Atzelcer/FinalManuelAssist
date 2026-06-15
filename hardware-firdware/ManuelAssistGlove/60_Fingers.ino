void actualizarDedo(uint8_t i, float dt) {
  if (!sensorOK[i]) return;

  tcaSelect(canales[i]);
  delayMicroseconds(800);

  float ax, ay, az, gx, gy, gz;
  if (!readMPU(sensorAddr[i], ax, ay, az, gx, gy, gz)) {
    return;
  }

  gx = deadzone(gx - gyroOffsetX[i]);
  gy = deadzone(gy - gyroOffsetY[i]);

  float accelAngleX = atan2(ay, az) * 180.0 / PI;
  float accelAngleY = atan2(-ax, sqrt((ay * ay) + (az * az))) * 180.0 / PI;

  accelAngleX -= neutralAngleX[i];
  accelAngleY -= neutralAngleY[i];

  angleX[i] = COMPLEMENTARY * (angleX[i] + gx * dt) + (1.0 - COMPLEMENTARY) * accelAngleX;
  angleY[i] = COMPLEMENTARY * (angleY[i] + gy * dt) + (1.0 - COMPLEMENTARY) * accelAngleY;

  angleXFilt[i] = (ALPHA_ANGLE * angleX[i]) + ((1.0 - ALPHA_ANGLE) * angleXFilt[i]);
  angleYFilt[i] = (ALPHA_ANGLE * angleY[i]) + ((1.0 - ALPHA_ANGLE) * angleYFilt[i]);

  String nuevoEstado = clasificarMovimiento(i);
  confirmarEstado(i, nuevoEstado);
}
