void enviarCambios() {
  unsigned long now = millis();

  for (uint8_t i = 0; i < NUM_SENSORES; i++) {
    if (estadoConfirmado[i] == "activo") {
      if (!pulsoActivoEnviado[i]) {
        enviarDato(dedos[i], "activo");
        ultimoEstadoEnviado[i] = "activo";
        pulsoActivoDesde[i] = now;
        pulsoActivoEnviado[i] = true;
        pulsoReposoForzado[i] = false;
      } else if (!pulsoReposoForzado[i] && now - pulsoActivoDesde[i] >= PULSO_ACTIVO_MS) {
        enviarDato(dedos[i], "reposo");
        ultimoEstadoEnviado[i] = "reposo";
        pulsoReposoForzado[i] = true;
      }
      continue;
    }

    if (pulsoActivoEnviado[i]) {
      pulsoActivoEnviado[i] = false;
      pulsoReposoForzado[i] = false;
      pulsoActivoDesde[i] = 0;
    }

    if (ultimoEstadoEnviado[i] != "reposo") {
      enviarDato(dedos[i], "reposo");
      ultimoEstadoEnviado[i] = "reposo";
    }
  }
}
