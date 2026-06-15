void resetearDedo(uint8_t i) {
  estadoTemporal[i] = "reposo";
  estadoConfirmado[i] = "reposo";
  ultimoEstadoEnviado[i] = "";
  pulsoActivoEnviado[i] = false;
  pulsoReposoForzado[i] = false;
  pulsoActivoDesde[i] = 0;
  contadorEstable[i] = 0;
  angleX[i] = 0;
  angleY[i] = 0;
  angleXFilt[i] = 0;
  angleYFilt[i] = 0;
  gyroRateX[i] = 0;
  gyroRateY[i] = 0;
}

String clasificarMovimiento(uint8_t i) {
  float intensidad = sqrt(
    angleXFilt[i] * angleXFilt[i] +
    angleYFilt[i] * angleYFilt[i]
  );

  if (estadoConfirmado[i] == "activo") {
    if (intensidad < ACTIVAR_OFF[i]) return "reposo";
    return "activo";
  }

  if (intensidad >= ACTIVAR_ON[i]) return "activo";
  return "reposo";
}

void confirmarEstado(uint8_t i, String nuevoEstado) {
  if (nuevoEstado == "reposo") {
    if (estadoTemporal[i] == "reposo") {
      contadorEstable[i]++;
    } else {
      estadoTemporal[i] = "reposo";
      contadorEstable[i] = 0;
    }

    if (contadorEstable[i] >= FRAMES_REPOSO_RAPIDO) {
      estadoConfirmado[i] = "reposo";
    }
    return;
  }

  if (nuevoEstado == estadoTemporal[i]) {
    contadorEstable[i]++;
  } else {
    estadoTemporal[i] = nuevoEstado;
    contadorEstable[i] = 0;
  }

  if (contadorEstable[i] >= FRAMES_CONFIRMACION) {
    estadoConfirmado[i] = "activo";
  }
}
