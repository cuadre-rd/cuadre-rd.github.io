// Portada de la web (solo en la PWA publicada: build.ps1 -Web marca <html data-web>) e inicio de sesión / registro.
// Estilo neumórfico blanco (relieve suave). Las cuentas usan Supabase Auth por su API REST, sin librerías ni CDN.
// Sin config.js lleno, la portada funciona igual y dice que las cuentas llegan pronto: Cuadre se usa sin cuenta.
window.Portada = (function () {
  'use strict';
  const T = window.T, $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cfg = () => window.CUADRE_CONFIG || {};
  const hayCuentas = () => !!(cfg().supabaseUrl && cfg().supabaseAnon);
  const SESION = 'cuadre-sesion', ENTRO = 'cuadre-entro';
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const poner = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  let alEntrar = () => {};

  const esWeb = () => document.documentElement.hasAttribute('data-web') && !window.Capacitor;
  const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // La portada sale a quien llega por primera vez a la web (sin datos y sin haber entrado antes). ?portada la muestra siempre.
  function debeMostrar(D) {
    if (/[?&]portada\b/.test(location.search)) return true;
    if (!esWeb() || instalada() || leer(ENTRO)) return false;
    return !D.movimientos.some(m => !m.borrado) && !D.cuentas.some(c => !c.borrado);
  }
  const sesion = () => { try { return JSON.parse(leer(SESION) || 'null'); } catch { return null; } };

  // ---------- Supabase Auth (REST) ----------
  async function auth(ruta, cuerpo) {
    const r = await fetch(cfg().supabaseUrl.replace(/\/$/, '') + '/auth/v1/' + ruta, {
      method: 'POST', headers: { apikey: cfg().supabaseAnon, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'error');
    return j;
  }
  // Token vigente (lo renueva con el refresh_token si venció). null = hay que iniciar sesión otra vez.
  async function tokenVigente() {
    const s = sesion(); if (!s) return null;
    if (Date.now() < s.vence - 60000) return s.access;
    try { const j = await auth('token?grant_type=refresh_token', { refresh_token: s.refresh }); guardarSesion({ ...j, user: j.user || { email: s.correo, user_metadata: { nombre: s.nombre } } }); return j.access_token; }
    catch { return null; }
  }
  // Borra la cuenta en el servidor (función borrar_mi_cuenta: solo la de quien tiene el token) y cierra la sesión.
  async function borrarCuenta() {
    const tok = await tokenVigente(); if (!tok) throw new Error(T.pSesionVencida);
    const r = await fetch(cfg().supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/borrar_mi_cuenta', {
      method: 'POST', headers: { apikey: cfg().supabaseAnon, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error(T.pErrorGeneral);
    poner(SESION, null);
  }
  const errorTxt = e => (/invalid login|invalid_grant|credentials/i.test(e.message) ? T.pErrorClave : /already|registered|exists/i.test(e.message) ? T.pYaExiste
    : /fetch|network|failed/i.test(e.message) ? T.pSinInternet : T.pErrorGeneral);
  const guardarSesion = j => poner(SESION, JSON.stringify({ correo: j.user && j.user.email, nombre: j.user && j.user.user_metadata && j.user.user_metadata.nombre,
    access: j.access_token, refresh: j.refresh_token, vence: Date.now() + (j.expires_in || 3600) * 1000 }));

  // ---------- pantallas ----------
  const logo = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset=".5" stop-color="#5E5CE6"/><stop offset="1" stop-color="#BF5AF2"/></linearGradient></defs><path d="M78 22 H30 Q18 22 18 34 V66 Q18 78 30 78 H78" fill="none" stroke="url(#pg)" stroke-width="13" stroke-linecap="round"/><circle cx="58" cy="50" r="12" fill="#30D158"/></svg>';
  // íconos dibujados (no emoji): candado, persona, sobre y ojo
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = { candado: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
    persona: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'), sobre: svg('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m4 7 8 6 8-6"/>'),
    ojo: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), listo: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>') };
  const fondo = '<div class="p-fondo" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
  function portadaHtml() {
    const fx = T.pFunciones.map(([i, t, d]) => `<li class="p-caja"><span class="p-ico">${i}</span><b>${t}</b><small>${d}</small></li>`).join('');
    const pasos = T.pPasos.map((p, i) => `<li><span class="p-num">${i + 1}</span><span>${p}</span></li>`).join('');
    return `${fondo}
      <header class="p-barra"><span class="p-marca"><span class="p-logo">${logo}</span>${T.app}</span><button class="p-enlace" data-p="login">${T.pEntrar}</button></header>
      <section class="p-hero">
        <span class="p-chip">● ${T.pChip}</span>
        <h1>${T.pTitulo1} <em>${T.pTitulo2}</em></h1>
        <p class="p-sub">${T.pSub}</p>
        <div class="p-botones"><button class="p-boton azul" data-p="registro">${T.pEmpezar}</button><button class="p-boton" data-p="login">${T.pTengoCuenta}</button></div>
        <ul class="p-checks"><li>✓ ${T.pCheck1}</li><li>✓ ${T.pCheck2}</li><li>✓ ${T.pCheck3}</li></ul>
        <div class="p-telefono"><img src="capturas/inicio.jpg" alt="${T.pCapturaAlt}" loading="lazy" width="780" height="1732"></div>
      </section>
      <section class="p-seccion"><h2>${T.pQueHace}</h2><ul class="p-funciones">${fx}</ul></section>
      <section class="p-seccion p-caja p-privado"><span class="p-ico">🔒</span><div><b>${T.pPrivadoT}</b><p>${T.pPrivado}</p></div></section>
      <section class="p-seccion"><h2>${T.pComoEmpezar}</h2><ol class="p-pasos">${pasos}</ol>
        <button class="p-boton azul ancho" data-p="instalar">⬇ ${T.pInstalar}</button>
        <button class="p-enlace centro" data-p="usar">${T.pUsarSinCuenta}</button></section>
      <footer class="p-pie"><span class="p-marca"><span class="p-logo">${logo}</span>${T.app}</span><small>${T.lema} · ${T.pHechoRD}</small>
        <small><a href="legal/privacidad.html">${T.pPrivacidad}</a> · <a href="legal/terminos.html">${T.pTerminos}</a> · <a href="mailto:cuadre.app.rd@gmail.com">${T.pContacto}</a></small></footer>`;
  }
  // Inicio de sesión y registro en la misma tarjeta (gira al cambiar), como el login de referencia en relieve.
  function authHtml(modo) {
    const reg = modo === 'registro', rec = modo === 'recuperar';
    const campo = (n, et, tipo, extra = '') => `<label class="p-campo"><span class="sr">${et}</span><input name="${n}" type="${tipo}" placeholder="${et}" autocomplete="${extra}" required>${tipo === 'password' ? `<button type="button" class="p-ojo" data-p="ver" aria-label="${T.pVerClave}">${IC.ojo}</button>` : ''}</label>`;
    return `${fondo}
      <button class="p-volver" data-p="portada" aria-label="${T.pVolver}">←</button>
      <form class="p-tarjeta p-caja ${reg ? 'gira' : ''}" novalidate>
        <span class="p-avatar">${reg ? IC.persona : rec ? IC.sobre : IC.candado}</span>
        <h1>${reg ? T.pCrearCuenta : rec ? T.pRecuperar : T.pBienvenido}</h1>
        <p class="p-sub">${reg ? T.pCrearSub : rec ? T.pRecuperarSub : T.pBienvenidoSub}</p>
        ${hayCuentas() ? '' : `<p class="p-aviso">${T.pPronto}</p>`}
        ${reg ? campo('nombre', T.pNombre, 'text', 'name') : ''}
        ${campo('correo', T.pCorreo, 'email', 'email')}
        ${rec ? '' : campo('clave', T.pClave, 'password', reg ? 'new-password' : 'current-password')}
        ${reg ? campo('clave2', T.pClave2, 'password', 'new-password') : ''}
        ${!reg && !rec ? `<div class="p-fila"><label class="p-check"><input type="checkbox" name="recordar" checked> ${T.pRecordar}</label><button type="button" class="p-enlace" data-p="recuperar">${T.pOlvide}</button></div>` : ''}
        ${reg ? `<p class="p-legal">${T.pAceptas('<a href="legal/terminos.html" target="_blank" rel="noopener">' + T.pTerminos + '</a>', '<a href="legal/privacidad.html" target="_blank" rel="noopener">' + T.pPrivacidad + '</a>')}</p>` : ''}
        <p class="p-error" role="alert"></p>
        <button class="p-boton azul ancho">${reg ? T.pCrearCuenta : rec ? T.pEnviarEnlace : T.pEntrar}</button>
        <p class="p-cambio">${reg ? T.pYaTienes : T.pNoTienes} <button type="button" class="p-enlace" data-p="${reg ? 'login' : 'registro'}">${reg ? T.pEntrar : T.pCrearCuenta}</button></p>
        <button type="button" class="p-enlace centro" data-p="usar">${T.pUsarSinCuenta}</button>
      </form>`;
  }

  function pintar(vista) {
    const raiz = $('#portada'); raiz.hidden = false; raiz.className = 'portada ' + (vista === 'portada' ? 'p-larga' : 'p-auth');
    raiz.innerHTML = vista === 'portada' ? portadaHtml() : authHtml(vista);
    raiz.scrollTop = 0;
    document.body.classList.add('con-portada');
    const f = raiz.querySelector('form'); if (f) f.onsubmit = ev => { ev.preventDefault(); enviar(vista, f); };
  }
  function cerrar() { const raiz = $('#portada'); raiz.hidden = true; raiz.innerHTML = ''; document.body.classList.remove('con-portada'); }

  // Revisa el formulario antes de hablar con el servidor (correo, clave de 8 o más y que coincidan).
  function validar(vista, d) {
    if (vista === 'registro' && !d.nombre) return T.pFaltaNombre;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo || '')) return T.pCorreoMal;
    if (vista === 'recuperar') return '';
    if ((d.clave || '').length < 8) return T.pClaveCorta;
    if (vista === 'registro' && d.clave !== d.clave2) return T.pNoCoinciden;
    return '';
  }
  async function enviar(vista, f) {
    const d = Object.fromEntries(new FormData(f)), err = f.querySelector('.p-error'), b = f.querySelector('.p-boton.azul');
    d.correo = String(d.correo || '').trim().toLowerCase(); d.nombre = String(d.nombre || '').trim();
    const malo = validar(vista, d); err.textContent = malo; if (malo) return;
    if (!hayCuentas()) { err.textContent = T.pPronto; return; }
    b.disabled = true; b.classList.add('cargando');
    try {
      if (vista === 'registro') {
        const j = await auth('signup', { email: d.correo, password: d.clave, data: { nombre: d.nombre } });
        if (j.access_token) { guardarSesion(j); entrar(); } else mensaje('sobre', T.pConfirmaT, T.pConfirma(d.correo));
      } else if (vista === 'recuperar') {
        await auth('recover', { email: d.correo }); mensaje('sobre', T.pRecuperarT, T.pRecuperarListo(d.correo));
      } else {
        guardarSesion(await auth('token?grant_type=password', { email: d.correo, password: d.clave })); entrar();
      }
    } catch (e) { err.textContent = errorTxt(e); }
    finally { b.disabled = false; b.classList.remove('cargando'); }
  }
  function mensaje(icono, titulo, texto) {
    const f = $('#portada form');
    f.innerHTML = `<span class="p-avatar listo">${IC[icono] || icono}</span><h1>${titulo}</h1><p class="p-sub">${esc(texto)}</p><button type="button" class="p-boton azul ancho" data-p="login">${T.pEntrar}</button>`;
  }
  function entrar() { poner(ENTRO, '1'); cerrar(); alEntrar(); }

  document.addEventListener('click', ev => {
    const b = ev.target.closest('#portada [data-p]'); if (!b) return;
    const p = b.dataset.p;
    if (p === 'usar') return entrar();
    if (p === 'instalar') return window.WalletApp && window.WalletApp.instalar();
    if (p === 'ver') { const i = b.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; return; }
    pintar(p);
  });

  return {
    debeMostrar, sesion, hayCuentas, borrarCuenta,
    mostrar(vista, { despues } = {}) { if (despues) alEntrar = despues; pintar(vista || 'portada'); },
    salir() { poner(SESION, null); },
    _validar: validar,
  };
})();
