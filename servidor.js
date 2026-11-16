// Servidor local de Feria Neón 84.
// Sirve el juego y guarda las puntuaciones en jugadores.json, en esta misma carpeta.
// Uso: node servidor.js [--puerto=8084] [--red] [--abrir]
//   --red    acepta conexiones de otros equipos de la red (por defecto, solo este ordenador)
//   --abrir  abre el juego en el navegador al arrancar
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { exec } = require('child_process');

const RAIZ = __dirname;
const ARCHIVO = path.join(RAIZ, 'jugadores.json');
const args = process.argv.slice(2);
const arg = (n) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : null; };
const PUERTO = Number(arg('puerto') || process.env.PORT || 8084);
const RED = args.includes('--red');
const HOST = RED ? '0.0.0.0' : '127.0.0.1';
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

/* ---------- base de datos ---------- */
function vacia() { return { juego: 'Feria Neón 84', version: 1, actualizado: null, jugadores: [], partidas: [] }; }
function leer() {
  try { const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); if (d && Array.isArray(d.jugadores) && Array.isArray(d.partidas)) return d; } catch (e) { /* no existe o está dañado */ }
  return vacia();
}
function guardar(db) { // se escribe en un temporal y se renombra, para no dejar nunca el archivo a medias
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, ARCHIVO);
}
function texto(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function numero(v, min, max) { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 0; }
function limpiar(p) { // ficha de una partida, con los campos acotados
  const usuario = texto(p && p.usuario, 24);
  if (!usuario) return null;
  return {
    id: texto(p.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    fecha: new Date().toISOString(), usuario,
    puntos: numero(p.puntos, 0, 99999), aciertos: numero(p.aciertos, 0, 20), preguntas: numero(p.preguntas, 0, 20),
    logros: Array.isArray(p.logros) ? p.logros.slice(0, 12).map((x) => texto(x, 40)) : [],
    modo: texto(p.modo, 30), duracionSeg: numero(p.duracionSeg, 0, 86400),
  };
}
function anotar(db, r) { // añade la partida y actualiza la ficha del jugador
  if (db.partidas.some((x) => x.id === r.id)) return;
  db.partidas.push(r);
  if (db.partidas.length > 5000) db.partidas.splice(0, db.partidas.length - 5000);
  const k = r.usuario.toLowerCase();
  let j = db.jugadores.find((x) => String(x.usuario).toLowerCase() === k);
  if (!j) { j = { usuario: r.usuario, partidas: 0, mejorPuntuacion: 0, mejorAciertos: 0, puntosTotales: 0, ultimaPuntuacion: 0, ultimaPartida: null }; db.jugadores.push(j); }
  j.partidas++; j.puntosTotales += r.puntos; j.ultimaPuntuacion = r.puntos; j.ultimaPartida = r.fecha;
  j.mejorPuntuacion = Math.max(j.mejorPuntuacion, r.puntos); j.mejorAciertos = Math.max(j.mejorAciertos, r.aciertos);
  db.jugadores.sort((a, b) => b.mejorPuntuacion - a.mejorPuntuacion || String(a.usuario).localeCompare(String(b.usuario)));
  db.actualizado = r.fecha;
}

/* ---------- servidor ---------- */
function json(res, estado, cuerpo) { res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(cuerpo)); }

const srv = http.createServer((req, res) => {
  let ruta;
  try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }

  if (ruta === '/api/jugadores') {
    if (req.method === 'GET') return json(res, 200, leer());
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }); return res.end(); }
    // solo JSON: así otra web abierta en el navegador no puede colar puntuaciones con un formulario
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Se esperaba application/json' });
    let cuerpo = '', grande = false;
    req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 65536) { grande = true; req.destroy(); } });
    req.on('end', () => {
      if (grande) return;
      let d;
      try { d = JSON.parse(cuerpo); } catch (e) { return json(res, 400, { error: 'JSON no válido' }); }
      const lista = Array.isArray(d && d.partidas) ? d.partidas.slice(0, 8) : [d];
      const db = leer();
      let n = 0;
      for (const p of lista) { const r = limpiar(p); if (r) { anotar(db, r); n++; } }
      if (!n) return json(res, 400, { error: 'Falta el usuario' });
      try { guardar(db); } catch (e) { return json(res, 500, { error: 'No se pudo escribir jugadores.json' }); }
      json(res, 200, db);
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (ruta.endsWith('/')) ruta += 'index.html';
  const fichero = path.join(RAIZ, ruta);
  // nada fuera de esta carpeta, ni archivos ocultos ni temporales
  if (!fichero.startsWith(RAIZ + path.sep) || path.basename(fichero).startsWith('.') || fichero.endsWith('.tmp')) { res.writeHead(404); return res.end(); }
  fs.readFile(fichero, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(fichero).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

srv.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'El puerto ' + PUERTO + ' ya está en uso. Prueba con: node servidor.js --puerto=8085' : String(e));
  process.exit(1);
});

if (!fs.existsSync(ARCHIVO)) { try { guardar(vacia()); } catch (e) { console.error('No se pudo crear jugadores.json: ' + e.message); } }

srv.listen(PUERTO, HOST, () => {
  const local = 'http://localhost:' + PUERTO;
  console.log('Feria Neón 84 en marcha: ' + local);
  console.log('Las puntuaciones se guardan en ' + ARCHIVO);
  if (RED) {
    for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log('Desde otros equipos de la red: http://' + i.address + ':' + PUERTO);
  }
  if (args.includes('--abrir')) {
    const orden = process.platform === 'win32' ? 'start "" "' + local + '"' : process.platform === 'darwin' ? 'open "' + local + '"' : 'xdg-open "' + local + '"';
    exec(orden, () => {});
  }
  console.log('Para parar el servidor: Ctrl + C');
});
