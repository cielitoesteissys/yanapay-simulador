const experience = document.querySelector('.experience');
const emergencyButton = document.querySelector('#emergency-button');
const braceletButton = document.querySelector('#bracelet-button');
const buttonLabel = document.querySelector('#button-label');
const buttonHint = document.querySelector('#button-hint');
const systemLabel = document.querySelector('#system-label');
const simStatus = document.querySelector('#sim-status');
const networkStatus = document.querySelector('#network-status');
const smsStatus = document.querySelector('#sms-status');
const progressTrack = document.querySelector('.progress-track');
const progressFill = document.querySelector('#progress-fill');
const messageToast = document.querySelector('#message-toast');
const soundToggle = document.querySelector('#sound-toggle');
const braceletCanvas = document.querySelector('#bracelet-canvas');
const braceletFallback = document.querySelector('#bracelet-model');
const insideDialog = document.querySelector('#inside-dialog');
const insideClose = document.querySelector('#inside-close');
const interiorDiagram = document.querySelector('#interior-diagram');
const interiorStatus = document.querySelector('#interior-status');

let simulationTimers = [];
let audioContext;
let ambientOscillator;
let ambientGain;

function startBraceletModel() {
  const gl = braceletCanvas.getContext('webgl', { alpha: true, antialias: true });
  if (!gl) {
    braceletCanvas.hidden = true;
    braceletFallback.hidden = false;
    braceletButton.classList.add('is-front');
    console.error('WebGL no está disponible; se muestra la imagen estática de respaldo.');
    return;
  }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform mat4 uModel;
    uniform mat4 uViewProjection;
    varying vec3 vNormal;
    varying vec3 vColor;
    void main() {
      gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
      vNormal = mat3(uModel) * aNormal;
      vColor = aColor;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vColor;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 light = normalize(vec3(-0.45, 0.65, 1.0));
      float diffuse = max(dot(normal, light), 0.0);
      float lighting = 0.43 + diffuse * 0.68;
      gl_FragColor = vec4(vColor * lighting, 1.0);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('No se pudo crear el shader WebGL.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`No se pudo compilar el modelo 3D: ${message}`);
    }
    return shader;
  }

  function addTriangle(data, a, b, c, normal, color) {
    for (const point of [a, b, c]) data.push(...point, ...normal, ...color);
  }

  function addQuad(data, a, b, c, d, normal, color) {
    addTriangle(data, a, b, c, normal, color);
    addTriangle(data, a, c, d, normal, color);
  }

  function addBox(data, center, size, color) {
    const [x, y, z] = center;
    const [w, h, d] = size;
    const x0 = x - w / 2, x1 = x + w / 2;
    const y0 = y - h / 2, y1 = y + h / 2;
    const z0 = z - d / 2, z1 = z + d / 2;
    addQuad(data, [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1], [0,0,1], color);
    addQuad(data, [x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0], [0,0,-1], color);
    addQuad(data, [x0,y0,z0], [x0,y0,z1], [x0,y1,z1], [x0,y1,z0], [-1,0,0], color);
    addQuad(data, [x1,y0,z1], [x1,y0,z0], [x1,y1,z0], [x1,y1,z1], [1,0,0], color);
    addQuad(data, [x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [x0,y1,z0], [0,1,0], color);
    addQuad(data, [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [x0,y0,z1], [0,-1,0], color);
  }

  function addCylinder(data, center, radius, depth, color, segments = 36) {
    const [x, y, z] = center;
    const front = z + depth / 2;
    const back = z - depth / 2;
    for (let i = 0; i < segments; i += 1) {
      const a = i * Math.PI * 2 / segments;
      const b = (i + 1) * Math.PI * 2 / segments;
      const p1 = [x + Math.cos(a) * radius, y + Math.sin(a) * radius, front];
      const p2 = [x + Math.cos(b) * radius, y + Math.sin(b) * radius, front];
      const q1 = [p1[0], p1[1], back];
      const q2 = [p2[0], p2[1], back];
      addTriangle(data, [x,y,front], p1, p2, [0,0,1], color);
      addTriangle(data, [x,y,back], q2, q1, [0,0,-1], color);
      const n = [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0];
      addQuad(data, p1, q1, q2, p2, n, color);
    }
  }

  function addSphere(data, center, radius, color, rings = 10, segments = 16) {
    for (let row = 0; row < rings; row += 1) {
      const v0 = row * Math.PI / rings;
      const v1 = (row + 1) * Math.PI / rings;
      for (let col = 0; col < segments; col += 1) {
        const u0 = col * Math.PI * 2 / segments;
        const u1 = (col + 1) * Math.PI * 2 / segments;
        const point = (v, u) => [
          center[0] + radius * Math.sin(v) * Math.cos(u),
          center[1] + radius * Math.cos(v),
          center[2] + radius * Math.sin(v) * Math.sin(u),
        ];
        const normal = (v, u) => [
          Math.sin(v) * Math.cos(u),
          Math.cos(v),
          Math.sin(v) * Math.sin(u),
        ];
        const a = point(v0, u0), b = point(v1, u0);
        const c = point(v1, u1), d = point(v0, u1);
        addTriangle(data, a, b, c, normal((v0 + v1) / 2, (u0 + u1) / 2), color);
        addTriangle(data, a, c, d, normal((v0 + v1) / 2, (u0 + u1) / 2), color);
      }
    }
  }

  function buildBracelet() {
    const data = [];
    const rx = 1.48, ry = 1.06, radialHalf = 0.17, depthHalf = 0.12;
    const profile = [
      [radialHalf, depthHalf],
      [-radialHalf, depthHalf],
      [-radialHalf, -depthHalf],
      [radialHalf, -depthHalf],
    ];
    const base = [0.83, 0.85, 0.86];
    const red = [0.83, 0.075, 0.12];
    const steps = 160;
    for (let i = 0; i < steps; i += 1) {
      const a = i * Math.PI * 2 / steps;
      const b = (i + 1) * Math.PI * 2 / steps;
      const mid = (a + b) / 2;
      const stripe = [-0.81, -0.65, -2.49, -2.33].some((center) => Math.abs(Math.atan2(Math.sin(mid - center), Math.cos(mid - center))) < 0.045);
      const color = stripe ? red : base;
      const point = (angle, index) => {
        const [radial, z] = profile[index];
        return [(rx + radial) * Math.cos(angle), (ry + radial) * Math.sin(angle), z];
      };
      for (let side = 0; side < 4; side += 1) {
        const next = (side + 1) % 4;
        let normal;
        if (side === 0) normal = [0, 0, 1];
        else if (side === 1) normal = [-Math.cos(mid), -Math.sin(mid), 0];
        else if (side === 2) normal = [0, 0, -1];
        else normal = [Math.cos(mid), Math.sin(mid), 0];
        addQuad(data, point(a, side), point(b, side), point(b, next), point(a, next), normal, color);
      }
    }

    addBox(data, [0, 1.055, 0], [0.31, 0.14, 0.26], [0.59, 0.62, 0.65]);
    for (let i = 0; i < 13; i += 1) {
      const theta = 0.42 + i * (2.3 / 12);
      addSphere(data, [rx * Math.cos(theta), ry * Math.sin(theta), 0.108], 0.027, [0.17, 0.19, 0.22], 6, 8);
    }

    const body = [0.66, 0.69, 0.73];
    addBox(data, [0, -1.055, 0.015], [1.02, 0.68, 0.4], body);
    addBox(data, [0, -0.765, 0.135], [0.59, 0.13, 0.13], [0.78, 0.79, 0.8]);
    addCylinder(data, [0, -1.055, 0.255], 0.36, 0.12, [0.24, 0.27, 0.30]);
    addCylinder(data, [0, -1.055, 0.33], 0.315, 0.08, [0.91, 0.045, 0.105]);
    addCylinder(data, [0, -1.055, 0.375], 0.237, 0.012, [0.97, 0.105, 0.15]);
    for (let i = 0; i < 12; i += 1) {
      const angle = i * Math.PI / 6;
      const outerRadius = 0.16;
      const innerRadius = 0.105;
      const halfWidth = 0.012;
      const outer = [Math.cos(angle) * outerRadius, -1.055 + Math.sin(angle) * outerRadius, 0.386];
      const innerLeft = [Math.cos(angle) * innerRadius - Math.sin(angle) * halfWidth, -1.055 + Math.sin(angle) * innerRadius + Math.cos(angle) * halfWidth, 0.386];
      const innerRight = [Math.cos(angle) * innerRadius + Math.sin(angle) * halfWidth, -1.055 + Math.sin(angle) * innerRadius - Math.cos(angle) * halfWidth, 0.386];
      addTriangle(data, outer, innerLeft, innerRight, [0,0,1], [0.98, 0.62, 0.27]);
    }
    addSphere(data, [0, -1.055, 0.399], 0.06, [1.0, 0.76, 0.42], 8, 12);
    addCylinder(data, [0.455, -1.045, 0.23], 0.11, 0.08, [0.22, 0.25, 0.27]);
    addSphere(data, [0.455, -1.045, 0.285], 0.074, [0.1, 0.95, 0.53], 10, 18);
    addCylinder(data, [-0.37, -0.94, 0.222], 0.045, 0.08, [0.13, 0.16, 0.19], 20);
    addCylinder(data, [-0.24, -0.94, 0.222], 0.045, 0.08, [0.13, 0.16, 0.19], 20);
    addCylinder(data, [-0.11, -0.94, 0.222], 0.045, 0.08, [0.13, 0.16, 0.19], 20);
    return new Float32Array(data);
  }

  let program;
  try {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    if (!program) throw new Error('No se pudo crear el programa WebGL.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`No se pudo enlazar el modelo 3D: ${gl.getProgramInfoLog(program)}`);
    }
  } catch (error) {
    braceletCanvas.hidden = true;
    braceletFallback.hidden = false;
    braceletButton.classList.add('is-front');
    console.error('No se pudo iniciar el modelo 3D de la pulsera.', error);
    return;
  }

  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('No se pudo crear el buffer de geometría del modelo 3D.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const vertices = buildBracelet();
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const vertexCount = vertices.length / 9;
  gl.useProgram(program);
  const stride = 9 * Float32Array.BYTES_PER_ELEMENT;
  const attributes = [
    ['aPosition', 3, 0],
    ['aNormal', 3, 3 * Float32Array.BYTES_PER_ELEMENT],
    ['aColor', 3, 6 * Float32Array.BYTES_PER_ELEMENT],
  ];
  for (const [name, size, offset] of attributes) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }
  const modelLocation = gl.getUniformLocation(program, 'uModel');
  const viewProjectionLocation = gl.getUniformLocation(program, 'uViewProjection');
  const perspective = (fieldOfView, aspect, near, far) => {
    const f = 1 / Math.tan(fieldOfView / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0,
    ]);
  };
  const speedSetting = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fieldOfView = Math.PI / 4.5;
  const cameraDistance = 4.2;
  let lastTime = 0;
  let angle = 0;

  function draw(time) {
    const bounds = braceletCanvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (braceletCanvas.width !== width || braceletCanvas.height !== height) {
      braceletCanvas.width = width;
      braceletCanvas.height = height;
    }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    const rotationSpeed = experience.classList.contains('alerting') ? 0.6 : 0.32;
    if (!speedSetting.matches) angle = (angle + delta * rotationSpeed) % (Math.PI * 2);

    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const c = Math.cos(angle), s = Math.sin(angle);
    const model = new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ]);
    const aspect = width / height;
    const projection = perspective(fieldOfView, aspect, 0.1, 30);
    projection[14] = projection[10] * -cameraDistance + projection[14];
    projection[15] = projection[11] * -cameraDistance + projection[15];
    const viewProjection = projection;
    gl.uniformMatrix4fv(modelLocation, false, model);
    gl.uniformMatrix4fv(viewProjectionLocation, false, viewProjection);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

    const buttonDepth = cameraDistance - Math.cos(angle) * 0.42;
    const focalLength = 1 / Math.tan(fieldOfView / 2);
    const buttonX = Math.sin(angle) * 0.42;
    const ndcX = buttonX * focalLength / (aspect * buttonDepth);
    const ndcY = -1.055 * focalLength / buttonDepth;
    braceletButton.style.left = `${(ndcX + 1) * 50}%`;
    braceletButton.style.top = `${(1 - ndcY) * 50}%`;
    braceletButton.style.width = `${Math.max(28, (0.62 * focalLength / buttonDepth) * height)}px`;
    braceletButton.classList.toggle('is-front', Math.cos(angle) > 0.12);
    window.requestAnimationFrame(draw);
  }

  window.requestAnimationFrame(draw);
}

function playTone(frequency, duration = 0.13, volume = 0.035) {
  if (soundToggle.getAttribute('aria-pressed') !== 'true') return;

  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    console.error('No se pudo reproducir el tono de demostración.', error);
  }
}

function setProgress(value) {
  progressFill.style.width = `${value}%`;
  progressTrack.setAttribute('aria-valuenow', String(value));
}

const braceletCanvasElement = document.querySelector('#bracelet-canvas');
if (braceletCanvasElement) braceletCanvasElement.hidden = true;

function clearSimulation(preservePreview = false) {
  simulationTimers.forEach(window.clearTimeout);
  simulationTimers = [];
  experience.classList.remove('alerting');
  emergencyButton.disabled = false;
  braceletButton.disabled = false;
  buttonLabel.textContent = 'SIMULAR EMERGENCIA';
  buttonHint.textContent = 'Pulsa el botón rojo para ver el interior y activar la alerta';
  systemLabel.textContent = 'SISTEMA LISTO';
  simStatus.textContent = 'Lista · simulada';
  networkStatus.textContent = 'En espera';
  smsStatus.textContent = 'En espera';
  smsStatus.className = 'status-idle';
  messageToast.hidden = true;
  setProgress(0);
  const smsPreview = document.querySelector('#smsPreview');
  if (smsPreview && !preservePreview) smsPreview.textContent = 'El mensaje aparecerá aquí al generar una alerta.';
  setInteriorStage('idle', 'Sistema en espera · pulsa el botón rojo');
}

function setInteriorStage(stage, status) {
  interiorDiagram.dataset.stage = stage;
  interiorStatus.textContent = status;
}

function runSimulation() {
  if (emergencyButton.disabled) return;

  clearSimulation(true);
  emergencyButton.disabled = true;
  braceletButton.disabled = true;
  experience.classList.add('alerting');
  buttonLabel.textContent = 'PROCESANDO ALERTA';
  buttonHint.textContent = 'Secuencia de prueba · no se envía ningún mensaje';
  systemLabel.textContent = 'ALERTA EN SIMULACIÓN';
  simStatus.textContent = 'Activada · demo';
  smsStatus.textContent = 'Preparando';
  smsStatus.className = 'status-working';
  setInteriorStage('button', 'Pulsador detectado · señal entrando al controlador');

  const stages = [
    () => {
      setProgress(24);
      networkStatus.textContent = 'Buscando señal…';
      networkStatus.className = 'status-working';
      setInteriorStage('controller', 'Controlador activo · procesando la alerta');
      playTone(480);
    },
    () => {
      setProgress(52);
      networkStatus.textContent = 'Red simulada OK';
      networkStatus.className = '';
      smsStatus.textContent = 'Creando aviso…';
      setInteriorStage('outputs', 'Indicador y zumbador activados · red solo simulada');
      playTone(620);
    },
    () => {
      setProgress(82);
      smsStatus.textContent = 'Vista previa lista';
      smsStatus.className = 'status-working';
      setInteriorStage('outputs', 'Aviso de prueba preparado · sin envío real');
      playTone(720);
    },
    () => {
      setProgress(100);
      smsStatus.textContent = 'NO ENVIADO · DEMO';
      smsStatus.className = 'status-error';
      systemLabel.textContent = 'PRUEBA COMPLETADA';
      buttonLabel.textContent = 'SIMULAR OTRA VEZ';
      buttonHint.textContent = 'La alerta se preparó solo en esta pantalla';
      emergencyButton.disabled = false;
      braceletButton.disabled = false;
      messageToast.hidden = false;
      setInteriorStage('complete', 'Secuencia completada · SMS no enviado');
      playTone(880, 0.24);
    },
  ];

  stages.forEach((stage, index) => {
    simulationTimers.push(window.setTimeout(stage, 700 + index * 950));
  });
}

const yanapayMusic = document.querySelector('#yanapayMusic');
const musicToggle = document.querySelector('#musicToggle');
const musicMute = document.querySelector('#musicMute');
const musicVolume = document.querySelector('#musicVolume');

async function activateYanapayMusic() {
  if (!yanapayMusic) return;
  try {
    yanapayMusic.volume = Number(musicVolume?.value ?? 0.35);
    await yanapayMusic.play();
    musicToggle?.setAttribute('aria-pressed', 'true');
    if (musicToggle) musicToggle.textContent = 'Pausar música';
  } catch (error) {
    if (musicToggle) musicToggle.textContent = 'Reproducir música';
    console.warn('El audio de YANAPAY no pudo iniciarse.', error);
  }
}

if (musicToggle) {
  musicToggle.addEventListener('click', async () => {
    if (!yanapayMusic) return;
    if (yanapayMusic.paused) {
      await activateYanapayMusic();
    } else {
      yanapayMusic.pause();
      musicToggle.setAttribute('aria-pressed', 'false');
      musicToggle.textContent = 'Reproducir música';
    }
  });
}

if (musicMute) {
  musicMute.addEventListener('click', () => {
    if (!yanapayMusic) return;
    yanapayMusic.muted = !yanapayMusic.muted;
    musicMute.setAttribute('aria-pressed', String(yanapayMusic.muted));
    musicMute.textContent = yanapayMusic.muted ? 'Activar sonido' : 'Silenciar';
  });
}

if (musicVolume) {
  musicVolume.addEventListener('input', () => {
    if (yanapayMusic) yanapayMusic.volume = Number(musicVolume.value);
  });
}

function generateEmergencyMessage() {
  const date = new Date().toLocaleString('es-PE');
  return `YANAPAY - Pulsera de la Confianza. Se ha activado una alerta de emergencia en la simulación. Fecha y hora: ${date}. Por favor, verifica la situación y comunícate con la persona que solicita asistencia. Esta alerta requiere verificación.`;
}

function updateSMSPreview() {
  const smsPreview = document.querySelector('#smsPreview');
  if (smsPreview) smsPreview.textContent = generateEmergencyMessage();
}

const copySMSButton = document.querySelector('#copySMS');
if (copySMSButton) {
  copySMSButton.addEventListener('click', async () => {
    const message = document.querySelector('#smsPreview')?.textContent || generateEmergencyMessage();
    try {
      await navigator.clipboard.writeText(message);
      copySMSButton.textContent = 'Mensaje copiado';
      window.setTimeout(() => { copySMSButton.textContent = 'Copiar mensaje'; }, 1600);
    } catch (error) {
      copySMSButton.textContent = 'No disponible';
      console.warn('No se pudo copiar el mensaje.', error);
    }
  });
}

const prepareSMSButton = document.querySelector('#prepareSMS');
if (prepareSMSButton) {
  prepareSMSButton.addEventListener('click', () => {
    const phoneInput = document.querySelector('#phoneNumber');
    const phone = phoneInput?.value.trim();
    if (!phone) {
      prepareSMSButton.textContent = 'Configura destinatario';
      return;
    }
    const message = document.querySelector('#smsPreview')?.textContent || generateEmergencyMessage();
    const smsLink = `sms:${phone.replace(/\s/g, '')}?body=${encodeURIComponent(message)}`;
    window.location.href = smsLink;
  });
}

emergencyButton.addEventListener('click', async () => {
  updateSMSPreview();
  await activateYanapayMusic();
  runSimulation();
});
const heroEmergencyButton = document.querySelector('#hero-emergency-button');
if (heroEmergencyButton) heroEmergencyButton.addEventListener('click', async () => {
  updateSMSPreview();
  await activateYanapayMusic();
  runSimulation();
});
const heroHowButton = document.querySelector('#hero-how-button');
if (heroHowButton) heroHowButton.addEventListener('click', () => {
  document.querySelector('#como-funciona')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const resetButton = document.querySelector('#reset-button');
if (resetButton) resetButton.addEventListener('click', () => clearSimulation(false));
braceletButton.addEventListener('click', async () => {
  braceletButton.classList.add('is-pressed');
  window.setTimeout(() => braceletButton.classList.remove('is-pressed'), 180);
  insideDialog.showModal();
  updateSMSPreview();
  await activateYanapayMusic();
  runSimulation();
});

insideClose.addEventListener('click', () => insideDialog.close());
insideDialog.addEventListener('click', (event) => {
  if (event.target === insideDialog) insideDialog.close();
});

soundToggle.addEventListener('click', () => {
  const enabled = soundToggle.getAttribute('aria-pressed') !== 'true';
  soundToggle.setAttribute('aria-pressed', String(enabled));
  soundToggle.setAttribute('aria-label', enabled ? 'Desactivar sonido ambiental' : 'Activar sonido ambiental');

  if (!enabled) {
    if (ambientOscillator) ambientOscillator.stop();
    ambientOscillator = undefined;
    ambientGain = undefined;
    return;
  }

  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    ambientOscillator = audioContext.createOscillator();
    ambientGain = audioContext.createGain();
    ambientOscillator.type = 'sine';
    ambientOscillator.frequency.value = 92;
    ambientGain.gain.value = 0.006;
    ambientOscillator.connect(ambientGain);
    ambientGain.connect(audioContext.destination);
    ambientOscillator.start();
    playTone(660, 0.16);
  } catch (error) {
    soundToggle.setAttribute('aria-pressed', 'false');
    soundToggle.setAttribute('aria-label', 'Activar sonido ambiental');
    console.error('No se pudo iniciar el sonido ambiental.', error);
  }
});
