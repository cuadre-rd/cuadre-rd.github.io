// Sincronización entre dispositivos (v24). Local primero: el teléfono y la PC guardan todo en su IndexedDB y se ponen al día con
// una copia CIFRADA en Supabase (tabla public.sincro, una fila por cuenta, RLS auth.uid() = user_id).
// - Cifrado de extremo a extremo: AES-GCM 256 con una llave sacada de la contraseña de la cuenta (PBKDF2-SHA256, 310 000 vueltas)
//   y la sal guardada en la fila. El servidor (y Cuadre) solo ve texto cifrado. La llave vive en este dispositivo.
// - Unión por registro: gana el «editado» más reciente; lo que solo existe en un lado se conserva. Nunca se borra nada que no se haya
//   borrado (el borrado es suave). Las fotos de facturas no se suben: se quedan en el dispositivo que las tomó.
// - Bloqueo optimista: la fila lleva «version»; si otro dispositivo subió primero, se vuelve a bajar, se une y se sube.
(function (g) {
  'use strict';
  const L = g.Logica || (typeof require !== 'undefined' ? require('./logica.js') : null);
  const LISTAS = ['cuentas', 'movimientos', 'categorias'].concat(L ? L.COLECCIONES : []);
  const LOCALES = ['huella', 'vista', 'ultimoRespaldo', 'ultimaCuenta']; // ajustes de este dispositivo: no viajan
  const ts = x => (x && (x.editado || x.creado)) || '';

  // ---------- unión (pura; probada en tests/v24-sincro.test.js) ----------
  function unir(local, remoto) {
    if (!remoto) return JSON.parse(JSON.stringify(local));
    const out = JSON.parse(JSON.stringify(local));
    for (const k of LISTAS) {
      const mapa = new Map((local[k] || []).map(x => [x.id, x]));
      for (const r of remoto[k] || []) {
        const l = mapa.get(r.id);
        if (!l) { mapa.set(r.id, r); continue; }
        if (ts(r) > ts(l)) mapa.set(r.id, l.foto && !r.foto ? { ...r, foto: l.foto } : r); // la foto se queda donde se tomó
      }
      out[k] = [...mapa.values()];
    }
    // Ajustes: los del dispositivo que guardó último, menos los propios de este dispositivo.
    const ra = remoto.ajustes || {}, la = local.ajustes || {};
    if ((remoto.ajustesT || '') > (local.ajustesT || '')) {
      out.ajustes = { ...ra }; for (const k of LOCALES) { if (k in la) out.ajustes[k] = la[k]; else delete out.ajustes[k]; }
      out.ajustesT = remoto.ajustesT;
    }
    // Bóveda (va cifrada con el PIN): la más reciente entera.
    if (remoto.boveda && (!local.boveda || (remoto.bovedaT || '') > (local.bovedaT || ''))) { out.boveda = remoto.boveda; out.bovedaT = remoto.bovedaT; }
    out.version = Math.max(local.version || 0, remoto.version || 0);
    return out;
  }
  // Lo que se sube: sin fotos ni ajustes propios del dispositivo.
  function paraSubir(d) {
    const c = JSON.parse(JSON.stringify(d));
    for (const m of c.movimientos || []) delete m.foto;
    for (const k of LOCALES) if (c.ajustes) delete c.ajustes[k];
    return c;
  }
  // Huella barata para saber si algo cambió (orden estable).
  function huella(d) {
    const c = paraSubir(d), partes = [JSON.stringify(c.ajustes || {}), c.boveda ? JSON.stringify(c.boveda) : ''];
    for (const k of LISTAS) partes.push(k + ':' + (c[k] || []).map(x => x.id + '@' + ts(x)).sort().join(','));
    return partes.join('|');
  }

  // ---------- cifrado ----------
  const cr = () => g.crypto && g.crypto.subtle;
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derivar(clave, salB64) {
    const base = await cr().importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
    const k = await cr().deriveKey({ name: 'PBKDF2', salt: deB64(salB64), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    return b64(await cr().exportKey('raw', k));
  }
  const llave = raw => cr().importKey('raw', deB64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  async function cifrar(raw, obj) {
    const iv = g.crypto.getRandomValues(new Uint8Array(12));
    const datos = await cr().encrypt({ name: 'AES-GCM', iv }, await llave(raw), new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, iv: b64(iv), datos: b64(datos) });
  }
  async function descifrar(raw, txt) {
    const c = JSON.parse(txt);
    const plano = await cr().decrypt({ name: 'AES-GCM', iv: deB64(c.iv) }, await llave(raw), deB64(c.datos));
    return JSON.parse(new TextDecoder().decode(plano));
  }

  // ---------- servidor ----------
  const P = () => g.Portada, cfg = () => g.CUADRE_CONFIG || {};
  const CLAVE = 'cuadre-sincro'; // { correo, llave, sal, activa, ultima, version, huella }
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch { return null; } };
  const poner = v => { try { if (v) localStorage.setItem(CLAVE, JSON.stringify(v)); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento: no hay sincronización */ } };
  async function api(ruta, { metodo = 'GET', cuerpo, prefer } = {}) {
    const tok = P() && await P().token(); if (!tok) throw Object.assign(new Error('sesion'), { codigo: 'sesion' });
    const r = await fetch(cfg().supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + ruta, { method: metodo,
      headers: { apikey: cfg().supabaseAnon, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((j && j.message) || 'red'), { codigo: 'red' });
    return j;
  }
  const fila = async () => ((await api('sincro?select=datos,sal,version,actualizado')) || [])[0] || null;

  // Al iniciar sesión (o al activar) con la contraseña: se saca la llave con la sal de la nube (o una sal nueva).
  async function activar(clave) {
    const s = P() && P().sesion(); if (!s || !cr()) throw new Error('sesion');
    const f = await fila(), sal = f ? f.sal : b64(g.crypto.getRandomValues(new Uint8Array(16)));
    const raw = await derivar(clave, sal);
    if (f) { try { await descifrar(raw, f.datos); } catch { poner({ correo: s.correo, llave: raw, sal, activa: true, conflictoClave: true }); return 'clave'; } }
    poner({ correo: s.correo, llave: raw, sal, activa: true, nueva: !f });
    return 'ok';
  }
  // La copia de la nube se hizo con otra contraseña (se cambió u olvidó): se reemplaza con la de este dispositivo.
  async function reemplazarNube(clave) {
    const s = P() && P().sesion(); if (!s) throw new Error('sesion');
    const sal = b64(g.crypto.getRandomValues(new Uint8Array(16)));
    poner({ correo: s.correo, llave: await derivar(clave, sal), sal, activa: true, nueva: true, reemplazar: true });
  }

  let corriendo = null, otraVez = false;
  // Pone al día este dispositivo y la nube. W = { datos(), aplicar(d) } lo da app.js.
  async function sincronizar(W) {
    if (corriendo) { otraVez = true; return corriendo; }
    corriendo = (async () => {
      const st = leer(), s = P() && P().sesion();
      if (!st || !st.activa || !s || st.correo !== s.correo || !cfg().supabaseUrl || st.conflictoClave) return estado();
      for (let intento = 0; intento < 3; intento++) {
        const f = st.reemplazar ? null : await fila();
        let remoto = null;
        if (f) {
          try { remoto = await descifrar(st.llave, f.datos); } catch { poner({ ...st, conflictoClave: true }); return estado(); }
          if ((remoto.version || 0) > L.VERSION) { poner({ ...st, error: 'version' }); return estado(); } // la otra copia es de una versión más nueva de Cuadre
        }
        const local = await W.persistido(), unido = L.normalizar(L.migrar(unir(local, remoto)));
        if (huella(unido) !== huella(local)) await W.aplicar(unido);
        const cambiaNube = !f || huella(unido) !== huella(remoto);
        if (cambiaNube) {
          const datos = await cifrar(st.llave, paraSubir(unido));
          if (!f && !st.reemplazar) {
            try { await api('sincro', { metodo: 'POST', cuerpo: { datos, sal: st.sal, version: 1 }, prefer: 'return=minimal' }); }
            catch (e) { if (intento < 2) continue; throw e; } // otro dispositivo creó la fila al mismo tiempo: se vuelve a unir
          } else if (st.reemplazar) {
            const r = await api('sincro?select=version', { metodo: 'GET' }); const v = r && r[0] ? r[0].version + 1 : 1;
            if (r && r[0]) await api('sincro?user_id=not.is.null', { metodo: 'PATCH', cuerpo: { datos, sal: st.sal, version: v, actualizado: new Date().toISOString() }, prefer: 'return=minimal' });
            else await api('sincro', { metodo: 'POST', cuerpo: { datos, sal: st.sal, version: 1 }, prefer: 'return=minimal' });
          } else {
            const r = await api('sincro?version=eq.' + f.version, { metodo: 'PATCH', cuerpo: { datos, version: f.version + 1, actualizado: new Date().toISOString() }, prefer: 'return=representation' });
            if (!r || !r.length) continue; // otro dispositivo subió primero: bajar, unir y volver a intentar
          }
        }
        poner({ ...st, nueva: false, reemplazar: false, error: null, ultima: Date.now() });
        return estado();
      }
      return estado();
    })().catch(e => { const st = leer(); if (st) poner({ ...st, error: e.codigo || 'red' }); return estado(); })
      .finally(() => { corriendo = null; if (otraVez) { otraVez = false; setTimeout(() => sincronizar(W), 500); } });
    return corriendo;
  }
  async function desactivar(borrarNube) {
    if (borrarNube) { try { await api('sincro?user_id=not.is.null', { metodo: 'DELETE', prefer: 'return=minimal' }); } catch (e) { if (e.codigo !== 'sesion') throw e; } }
    poner(null);
  }
  function estado() {
    const st = leer(), s = P() && P().sesion();
    if (!s) return { estado: 'sinSesion' };
    if (!st || st.correo !== s.correo) return { estado: 'apagada' };
    if (st.conflictoClave) return { estado: 'clave' };
    return { estado: st.error ? 'error' : 'activa', error: st.error, ultima: st.ultima || null };
  }

  const api_ = { unir, paraSubir, huella, derivar, cifrar, descifrar, activar, reemplazarNube, sincronizar, desactivar, estado, olvidar: () => poner(null) };
  g.Sincro = api_;
  if (typeof module !== 'undefined') module.exports = api_;
})(typeof globalThis !== 'undefined' ? globalThis : this);
