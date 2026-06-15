bool writeByte(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

int16_t to16(uint8_t h, uint8_t l) {
  return (int16_t)((h << 8) | l);
}

bool read14(uint8_t addr, uint8_t* buf) {
  Wire.beginTransmission(addr);
  Wire.write(REG_ACCEL_XOUT_H);

  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)14) != 14) return false;

  for (int i = 0; i < 14; i++) {
    buf[i] = Wire.read();
  }

  return true;
}

bool readMPU(uint8_t addr,
             float &ax, float &ay, float &az,
             float &gx, float &gy, float &gz) {
  uint8_t raw[14];

  if (!read14(addr, raw)) return false;

  int16_t rax = to16(raw[0], raw[1]);
  int16_t ray = to16(raw[2], raw[3]);
  int16_t raz = to16(raw[4], raw[5]);
  int16_t rgx = to16(raw[8], raw[9]);
  int16_t rgy = to16(raw[10], raw[11]);
  int16_t rgz = to16(raw[12], raw[13]);

  ax = rax / 16384.0;
  ay = ray / 16384.0;
  az = raz / 16384.0;
  gx = rgx / 131.0;
  gy = rgy / 131.0;
  gz = rgz / 131.0;

  return true;
}

bool configurarMPU(uint8_t addr) {
  if (!writeByte(addr, REG_PWR_MGMT_1, 0x00)) return false;
  delay(80);

  bool ok = true;
  ok &= writeByte(addr, REG_SMPLRT_DIV, 0x07);
  ok &= writeByte(addr, REG_CONFIG, 0x03);
  ok &= writeByte(addr, REG_GYRO_CONFIG, 0x00);
  ok &= writeByte(addr, REG_ACCEL_CONFIG, 0x00);

  delay(80);
  return ok;
}

float deadzone(float v) {
  if (abs(v) < DEADZONE_GYRO) return 0.0;
  return v;
}
