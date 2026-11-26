// Plan del sueldo, consejos por país y ciudad, proyección de ahorro y logros (lógica pura). Probada en tests/v4.test.js.
// Base: reglas de presupuesto de uso común en educación financiera (orientación general, no asesoría):
//   50/30/20 (necesidades/deseos/ahorro), 60/20/20 (ciudad cara), 70/20/10 (ingreso justo), 50/20/30 (salir de deudas / ahorro fuerte).
//   Vivienda ≈ 30 % del ingreso como guía; fondo de emergencia de 3 a 6 meses de gastos básicos.
(function (g) {
  'use strict';
  const L = g.Logica || (typeof require !== 'undefined' ? require('./logica.js') : null);
  const PL = g.Planes || (typeof require !== 'undefined' ? require('./planes.js') : null);
  const PR = g.Prestamos || (typeof require !== 'undefined' ? require('./prestamos.js') : null);

  const REGLAS = { '50/30/20': [50, 30, 20], '60/20/20': [60, 20, 20], '70/20/10': [70, 20, 10], '50/20/30': [50, 20, 30] };
  // Reparto dentro de cada grupo (se mezcla con lo que la persona gasta de verdad).
  const NECESIDADES = { 'c-casa': 0.36, 'c-comida': 0.24, 'c-servicios': 0.12, 'c-transporte': 0.12, 'c-salud': 0.06, 'c-educacion': 0.05, 'c-familia': 0.05 };
  const DESEOS = { 'c-ocio': 0.30, 'c-ropa': 0.20, 'c-internet': 0.20, 'c-juegos': 0.10, 'c-regalos': 0.10, 'c-mascotas': 0.10 };

  // Costo de vida aproximado por ciudad (alto, medio, bajo). El usuario lo puede cambiar.
  const CIUDADES = {
    DO: { 'Distrito Nacional': 'alto', 'Santo Domingo Este': 'medio', 'Santo Domingo Norte': 'medio', 'Santo Domingo Oeste': 'medio', 'Punta Cana / Bávaro': 'alto',
      'Santiago': 'medio', 'La Romana': 'medio', 'Puerto Plata': 'medio', 'San Pedro de Macorís': 'medio', 'Higüey': 'medio', 'La Vega': 'medio',
      'San Francisco de Macorís': 'medio', 'Moca': 'bajo', 'Bonao': 'bajo', 'Baní': 'bajo', 'San Cristóbal': 'medio', 'Barahona': 'bajo', 'Samaná / Las Terrenas': 'alto' },
    US: { 'Nueva York': 'alto', 'Miami': 'alto', 'Boston': 'alto', 'Los Ángeles': 'alto', 'Orlando': 'medio', 'Houston': 'medio', 'Filadelfia': 'medio' },
    PR: { 'San Juan': 'alto', 'Bayamón': 'medio', 'Ponce': 'bajo', 'Mayagüez': 'bajo' },
    MX: { 'Ciudad de México': 'alto', 'Monterrey': 'alto', 'Guadalajara': 'medio', 'Cancún': 'alto', 'Puebla': 'medio', 'Mérida': 'medio' },
    CO: { 'Bogotá': 'alto', 'Medellín': 'medio', 'Cali': 'medio', 'Barranquilla': 'medio', 'Cartagena': 'alto' },
    ES: { 'Madrid': 'alto', 'Barcelona': 'alto', 'Valencia': 'medio', 'Sevilla': 'medio', 'Málaga': 'medio' },
  };
  const VIVIENDA = { alto: 35, medio: 30, bajo: 25 }; // % máximo sugerido para vivienda

  const sumaVals = o => Object.values(o).reduce((s, v) => s + v, 0);

  // Ingreso mensual: el que escribió el usuario, si no la nómina (neto al mes), si no el promedio de ingresos.
  function ingresoMensual(d, fechaHoy) {
    if (d.ajustes.ingresoPlan > 0) return { monto: d.ajustes.ingresoPlan, origen: 'manual' };
    // v24: la nómina de la pareja solo cuenta con el Hogar activo (entonces el plan es del hogar).
    const hogar = d.ajustes.hogar && d.ajustes.hogar.activo, ns = (d.nominas || []).filter(n => !n.borrado && (hogar || n.dueno !== 'pareja'));
    if (ns.length) return { monto: Math.round(ns.reduce((s, n) => s + PL.nominaNeto(n, d.ajustes.pais).neto * L.vecesAlMes(n.rec), 0)), origen: 'nomina' };
    return { monto: L.promedios(d, fechaHoy).ingresos, origen: 'promedio' };
  }
  // Gasto promedio por categoría principal: últimos 3 meses completos con datos; si no hay, el mes en curso.
  function gastoPromedio(d, fechaHoy) {
    const h = fechaHoy || L.hoy(), mes = h.slice(0, 7), out = {};
    const meses = [1, 2, 3].map(i => L.mesAnterior(mes, i)).map(m => L.flujoMes(d, m)).filter(f => f.gastos > 0);
    const base = meses.length ? meses : [L.flujoMes(d, mes)];
    for (const f of base) for (const [k, v] of Object.entries(f.porCat)) out[k] = (out[k] || 0) + v / base.length;
    for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
    return out;
  }
  const deudaCara = d => d.cuentas.some(c => !c.borrado && (c.tipo === 'credito' || c.tipo === 'deuda') && L.saldoCuenta(d, c.id) < 0);

  function costoVida(d) {
    if (d.ajustes.costoVida) return d.ajustes.costoVida;
    const c = (CIUDADES[d.ajustes.pais] || {})[d.ajustes.ciudad];
    return c || 'medio';
  }
  function recomendarRegla(d, ingreso, gastos) {
    const necesidades = Object.keys(NECESIDADES).reduce((s, k) => s + (gastos[k] || 0), 0);
    if (ingreso > 0 && necesidades / ingreso > 0.65) return '70/20/10';
    if (deudaCara(d)) return '50/20/30';
    if (costoVida(d) === 'alto') return '60/20/20';
    return '50/30/20';
  }
  // Reparte el monto de un grupo entre sus categorías: mitad pesos base, mitad lo que la persona gasta en realidad.
  function repartir(monto, pesos, gastos) {
    const real = Object.keys(pesos).reduce((s, k) => s + (gastos[k] || 0), 0);
    const w = {};
    for (const k of Object.keys(pesos)) w[k] = real > 0 ? 0.5 * pesos[k] + 0.5 * ((gastos[k] || 0) / real) : pesos[k];
    const tot = sumaVals(w) || 1, out = {};
    for (const k of Object.keys(w)) out[k] = Math.round((monto * w[k]) / tot);
    return out;
  }

  // v24: pagos fijos activos por categoría principal, al mes y en moneda principal.
  function fijosPorCat(d) {
    const out = {};
    for (const f of (d.fijos || []).filter(f => !f.borrado && !f.pausado && f.categoriaId)) {
      const c = f.cuentaId && d.cuentas.find(x => x.id === f.cuentaId), id = L.padreDe(d, f.categoriaId) || f.categoriaId;
      const v = L.aPrincipal(d, f.monto || 0, c ? c.moneda : d.ajustes.monedaPrincipal);
      out[id] = (out[id] || 0) + Math.round((v == null ? f.monto || 0 : v) * L.vecesAlMes(f.rec));
    }
    return out;
  }
  // El plan completo del mes.
  function plan(d, fechaHoy) {
    const h = fechaHoy || L.hoy(), ing = ingresoMensual(d, h), gastos = gastoPromedio(d, h);
    const sugerida = recomendarRegla(d, ing.monto, gastos);
    const regla = REGLAS[d.ajustes.regla] ? d.ajustes.regla : sugerida;
    const [n, w, s] = REGLAS[regla], I = ing.monto;
    const grupos = { necesidades: Math.round((I * n) / 100), deseos: Math.round((I * w) / 100), ahorro: Math.round((I * s) / 100) };
    // Categorías propias del usuario (con grupo) también reciben su parte.
    const propias = gr => Object.fromEntries(d.categorias.filter(c => !c.borrado && !c.padre && c.tipo === 'gasto' && c.grupo === gr && !NECESIDADES[c.id] && !DESEOS[c.id]).map(c => [c.id, 0.05]));
    // v24: lo que la persona no usa (categoría oculta o borrada) sale del reparto y su parte va a las demás.
    const usa = pesos => Object.fromEntries(Object.entries(pesos).filter(([id]) => { const c = d.categorias.find(x => x.id === id); return c && !c.borrado && !c.oculta; }));
    const propio = d.ajustes.planPropio || {}, fijos = fijosPorCat(d), gastosR = { ...gastos, ...fijos, ...propio }; // v24: lo real = lo que puso la persona, si no sus pagos fijos, si no lo anotado
    const cats = { ...repartir(grupos.necesidades, usa({ ...NECESIDADES, ...propias('necesidades') }), gastosR), ...repartir(grupos.deseos, usa({ ...DESEOS, ...propias('deseos') }), gastosR) };
    // Tope de vivienda: lo que sobra pasa al resto de necesidades.
    const tope = Math.round((I * VIVIENDA[costoVida(d)]) / 100);
    if (cats['c-casa'] > tope) {
      const sobra = cats['c-casa'] - tope; cats['c-casa'] = tope;
      const otras = Object.keys(NECESIDADES).filter(k => k !== 'c-casa' && k in cats), base = otras.reduce((t, k) => t + cats[k], 0) || 1;
      for (const k of otras) cats[k] += Math.round((sobra * cats[k]) / base);
    }
    const filas = Object.entries(cats).map(([id, sugerido]) => {
      const real = propio[id] > 0 ? propio[id] : Math.max(fijos[id] || 0, gastos[id] || 0);
      return { id, grupo: grupoDe(d, id) || 'deseos', sugerido, propio: propio[id] > 0, fijo: !(propio[id] > 0) && fijos[id] > 0 && fijos[id] >= (gastos[id] || 0), real, estado: !sugerido ? 'ok' : real > sugerido * 1.1 ? 'pasado' : real > sugerido * 0.9 ? 'justo' : 'ok' };
    });
    // Ahorro: primero el fondo de emergencia, después deudas caras, después metas e inversión.
    const fondo = fondoEmergencia(d, h, grupos.necesidades);
    const reparto = fondo.falta > 0 ? (deudaCara(d) ? { fondo: 0.5, deudas: 0.3, metas: 0.2 } : { fondo: 0.6, deudas: 0, metas: 0.4 })
      : (deudaCara(d) ? { fondo: 0, deudas: 0.6, metas: 0.4 } : { fondo: 0, deudas: 0, metas: 1 });
    const ahorro = Object.fromEntries(Object.entries(reparto).map(([k, v]) => [k, Math.round(grupos.ahorro * v)]));
    fondo.mesesParaLlegar = fondo.falta > 0 && ahorro.fondo > 0 ? Math.ceil(fondo.falta / ahorro.fondo) : 0;
    return { ingreso: ing, regla, sugerida, porcentajes: { necesidades: n, deseos: w, ahorro: s }, grupos, filas, ahorro, fondo, costo: costoVida(d), topeVivienda: tope };
  }

  // Fondo de emergencia: 6 meses de gastos básicos (3 si tiene nómina fija registrada). Cuenta ahorro + uso diario.
  function fondoEmergencia(d, fechaHoy, basicosSugeridos) {
    const r = L.resumen(d, fechaHoy || L.hoy());
    const gastos = gastoPromedio(d, fechaHoy);
    const basicosReales = Object.keys(NECESIDADES).reduce((s, k) => s + (gastos[k] || 0), 0);
    const basicos = Math.max(basicosReales, basicosSugeridos || 0);
    const meses = (d.nominas || []).some(n => !n.borrado) ? 3 : 6;
    const meta = basicos * meses, tienes = Math.max(0, r.porTipo.ahorro + r.porTipo.diaria);
    return { meses, meta, tienes, falta: Math.max(0, meta - tienes), pct: meta ? Math.min(1, tienes / meta) : 0, basicos };
  }

  // Si ahorras «aporte» al mes (con tasa anual opcional), cuánto tendrás en 1, 3 y 5 años.
  function proyeccionAhorro(inicial, aporte, tasaAnual) {
    const r = PR.ahorro({ inicial, aporte, tasa: tasaAnual || 0, meses: 60 });
    const en = m => r.filas[m - 1].saldo;
    return { anio1: en(12), anio3: en(36), anio5: en(60), serie: [inicial].concat(r.filas.map(f => f.saldo)) };
  }

  // ---------- logros (se celebran una vez) ----------
  const LOGROS = ['primer-ahorro', 'fondo-1', 'fondo-3', 'fondo-6', 'ahorro-10', 'ahorro-20', 'mes-presupuesto', 'racha-7', 'racha-30',
    'meta-lograda', 'deuda-saldada', 'sam-cobrado', 'comision', 'plan-aplicado'];
  function logros(d, fechaHoy) {
    const h = fechaHoy || L.hoy(), mesPas = L.mesAnterior(h.slice(0, 7));
    const s = L.salud(d, h), fp = L.flujoMes(d, mesPas), pr = L.presupuesto(d, mesPas), racha = L.racha(d, h);
    const tasaPas = fp.ingresos > 0 ? (fp.ingresos - fp.gastos) / fp.ingresos : 0;
    const vivos = d.movimientos.filter(m => !m.borrado);
    const hecho = {
      'primer-ahorro': d.cuentas.some(c => !c.borrado && (c.tipo === 'ahorro' || c.tipo === 'inversion') && L.saldoCuenta(d, c.id) > 0),
      'fondo-1': s.mesesEmergencia >= 1, 'fondo-3': s.mesesEmergencia >= 3, 'fondo-6': s.mesesEmergencia >= 6,
      'ahorro-10': tasaPas >= 0.1, 'ahorro-20': tasaPas >= 0.2,
      'mes-presupuesto': pr.limite > 0 && fp.gastos > 0 && pr.usado <= pr.limite,
      'racha-7': racha >= 7, 'racha-30': racha >= 30,
      'meta-lograda': (d.metas || []).some(m => !m.borrado && PL.meta(d, m, h).lograda),
      'deuda-saldada': d.cuentas.some(c => !c.borrado && c.tipo === 'deuda' && L.saldoCuenta(d, c.id) === 0 && vivos.some(m => m.cuentaDestinoId === c.id)),
      'sam-cobrado': vivos.some(m => m.ref && m.ref.tipo === 'sam' && m.ref.periodo.startsWith('c')),
      'comision': vivos.some(m => m.categoriaId === 'c-comision'),
      'plan-aplicado': !!d.ajustes.planAplicado,
    };
    const lista = LOGROS.map(id => ({ id, hecho: !!hecho[id] }));
    return { lista, hechos: lista.filter(x => x.hecho).length, total: lista.length };
  }

  // Grupo de una categoría (necesidades o deseos): las propias del usuario traen «grupo»; las de fábrica, por su lista.
  function grupoDe(d, catId) {
    const padre = L.padreDe(d, catId), c = d.categorias.find(x => x.id === padre) || {};
    return c.grupo || (NECESIDADES[padre] ? 'necesidades' : DESEOS[padre] ? 'deseos' : null);
  }

  // ---------- salud por período (7, 15, 30, 90, 180 o 365 días) con semáforo y consejos ----------
  // Puntos (0–100): ahorro del período (40), presupuesto prorrateado (30) y tendencia contra el período anterior (30).
  const PERIODOS = [7, 15, 30, 90, 180, 365];
  const lim01 = x => Math.max(0, Math.min(1, x));
  function saludPeriodo(d, dias, fechaHoy) {
    const h = fechaHoy || L.hoy(), desde = L.sumarDias(h, -(dias - 1));
    const prevHasta = L.sumarDias(desde, -1), prevDesde = L.sumarDias(prevHasta, -(dias - 1));
    const f = L.flujoRango(d, desde, h), fp = L.flujoRango(d, prevDesde, prevHasta);
    const ing = f.ingresos, gas = f.gastos, tasa = ing > 0 ? (ing - gas) / ing : gas > 0 ? -1 : 0;
    const pres = d.ajustes.presupuestos || {};
    let lim = 0, usado = 0;
    const pasadas = [];
    for (const [k, v] of Object.entries(pres)) {
      const l = Math.round((v * dias) / 30.4), u = f.porCat[k] || 0;
      lim += l; usado += u;
      if (u > l) pasadas.push({ id: k, exceso: u - l });
    }
    const gustos = Object.entries(f.porCat).filter(([k]) => grupoDe(d, k) === 'deseos').reduce((s, [, v]) => s + v, 0);
    const cambio = fp.gastos > 0 ? gas / fp.gastos - 1 : null;
    const sinDatos = !ing && !gas;
    const ptsAhorro = Math.round(40 * lim01(tasa / 0.2));
    const ptsPres = lim ? Math.round(30 * lim01(2 - usado / lim)) : 15;
    const ptsTend = cambio === null ? 15 : Math.round(30 * lim01(1 - cambio / 0.3));
    const puntos = sinDatos ? null : ptsAhorro + ptsPres + ptsTend;
    const nivel = puntos === null ? 'gris' : puntos >= 70 ? 'verde' : puntos >= 40 ? 'amarillo' : 'rojo';
    // Lo que más subió contra el período anterior.
    let subio = null;
    for (const [k, v] of Object.entries(f.porCat)) { const dlt = v - (fp.porCat[k] || 0); if (dlt > 0 && (!subio || dlt > subio.delta)) subio = { id: k, delta: dlt }; }
    const top = Object.entries(f.porCat).sort((a, b) => b[1] - a[1])[0];
    const consejos = [];
    const c = (tipo, clave, datos) => consejos.push({ tipo, clave, datos: datos || {} });
    if (!sinDatos) {
      if (!ing) c('ojo', 'sinIngresos');
      else if (tasa < 0) c('mal', 'gastasMas', { monto: gas - ing });
      else if (tasa < 0.1) c('ojo', 'ahorroBajo', { pct: Math.round(tasa * 100) });
      else if (tasa >= 0.2) c('bien', 'ahorroAlto', { pct: Math.round(tasa * 100) });
      else c('bien', 'ahorroMedio', { pct: Math.round(tasa * 100) });
      pasadas.sort((a, b) => b.exceso - a.exceso).slice(0, 2).forEach(p => c('mal', 'presupuestoPasado', p));
      if (cambio !== null && cambio > 0.15 && subio) c('ojo', 'subioGasto', { pct: Math.round(cambio * 100), id: subio.id, monto: subio.delta });
      if (cambio !== null && cambio < -0.1) c('bien', 'bajoGasto', { pct: Math.round(-cambio * 100) });
      if (ing > 0 && gustos / ing > 0.3) c('ojo', 'muchosGustos', { pct: Math.round((gustos / ing) * 100) });
      if (top) c('info', 'top', { id: top[0], monto: top[1], pct: Math.round((top[1] / gas) * 100) });
    }
    // Serie de los últimos 6 períodos del mismo largo (el más viejo primero).
    const serie = [];
    for (let i = 5; i >= 0; i--) {
      const hs = L.sumarDias(h, -dias * i), ds = L.sumarDias(hs, -(dias - 1)), fx = L.flujoRango(d, ds, hs);
      serie.push({ desde: ds, hasta: hs, ingresos: fx.ingresos, gastos: fx.gastos });
    }
    return { dias, desde, hasta: h, ingresos: ing, gastos: gas, ahorro: ing - gas, tasa, gastoDiario: Math.round(gas / dias), cambio,
      limite: lim, usado, gustos, puntos, nivel, partes: { ahorro: ptsAhorro, presupuesto: ptsPres, tendencia: ptsTend }, consejos, serie };
  }

  // ---------- v24: asesor de tarjetas, ¿me alcanza el sueldo?, plan para salir de deudas y recortes ----------
  // Orientación general con los datos del propio usuario; todo se calcula en el teléfono. No es asesoría financiera.
  const vivas = a => (a || []).filter(x => !x.borrado);
  const tarjetasCC = d => vivas(d.cuentas).filter(c => c.tipo === 'credito' && !c.castigado && !c.parDe);
  const aP = (d, v, mon) => { const x = L.aPrincipal(d, v, mon); return x == null ? v : x; }; // sin tasa guardada: se toma tal cual
  // Una compra hecha en la fecha h entra en el próximo corte (el mismo día del corte cuenta) y se paga en el día límite siguiente.
  function compraHoy(c, h) {
    if (!c.diaCorte || !c.diaPago) return null;
    const corte = L.proximaFecha({ frec: 'mensual', dia: c.diaCorte }, h);
    const pago = corte && L.proximaFecha({ frec: 'mensual', dia: c.diaPago }, L.sumarDias(corte, 1));
    return pago ? { corte, pago, dias: L.diasEntre(h, pago) } : null;
  }
  // Tarjetas de mejor a peor para comprar hoy: que alcance el disponible y no pase del 90 % del límite, más días para pagar y menos uso.
  function rankingTarjetas(d, h, monto) {
    monto = monto > 0 ? monto : 0;
    return tarjetasCC(d).map(c => {
      const ch = compraHoy(c, h); if (!ch) return null;
      const deuda = Math.max(0, -L.saldoCuenta(d, c.id)), disp = c.limite ? c.limite - deuda : null;
      const uso = c.limite ? (deuda + monto) / c.limite : 0;
      return { c, ...ch, deuda, disp, uso, ok: (disp == null || monto <= disp) && uso <= 0.9 };
    }).filter(Boolean).sort((a, b) => (b.ok - a.ok) || (b.dias - a.dias) || (a.uso - b.uso));
  }
  // Deudas en moneda principal: tarjetas (tasa anual propia o 60 % supuesta; mínimo 5 % o RD$1,000) y préstamos con su cuota.
  function deudas(d) {
    const out = [], piso = d.ajustes.monedaPrincipal === 'DOP' ? 100000 : 2500; // pago mínimo de referencia: RD$1,000 o 25 en otra moneda
    for (const c of vivas(d.cuentas).filter(c => c.tipo === 'credito' && !c.castigado)) {
      const saldo = aP(d, -L.saldoCuenta(d, c.id), c.moneda); if (saldo <= 0) continue;
      const tasa = c.tasa > 0 ? c.tasa : 60;
      out.push({ id: c.id, nombre: c.banco || c.nombre, tipo: 'tarjeta', saldo, tasaAnual: tasa, supuesta: !(c.tasa > 0), tasaMes: tasa / 1200, minimo: Math.min(saldo, Math.max(Math.round(saldo * 0.05), piso)) });
    }
    for (const c of vivas(d.cuentas).filter(c => c.tipo === 'deuda' && !c.castigado)) {
      const saldo = aP(d, -L.saldoCuenta(d, c.id), c.moneda); if (saldo <= 0) continue;
      const pl = c.plan, sig = pl ? PL.siguienteCuota(d, c) : null;
      const tasaMes = pl ? PR.tasaPorCuota(Number(pl.tasa) || 0, pl.periodoTasa, 'mensual') : 0;
      const cuotaMes = sig ? Math.round(aP(d, sig.fila.cuota, c.moneda) * (PR.POR_ANIO[pl.frecuencia] || 12) / 12) : 0;
      out.push({ id: c.id, nombre: c.nombre, tipo: 'prestamo', saldo, tasaAnual: Math.round(tasaMes * 1200 * 10) / 10, supuesta: !pl, tasaMes, minimo: Math.min(saldo, cuotaMes || Math.max(Math.round(saldo * 0.05), piso)) });
    }
    return out;
  }
  // Simulación mes a mes. avalancha: el extra va a la de interés más alto; bola: a la más pequeña.
  // soloMinimos: cada deuda paga solo su mínimo (para comparar cuánto se ahorra con el plan).
  function planDeudas(lista, pago, metodo, soloMinimos) {
    const ds = lista.map(x => ({ ...x })), minTot = ds.reduce((s, x) => s + x.minimo, 0);
    if (!ds.length) return { meses: 0, interes: 0, orden: [], minTot: 0, falta: 0 };
    if (!soloMinimos && pago < minTot) return { meses: null, interes: null, orden: [], minTot, falta: minTot - pago };
    let mes = 0, interes = 0; const orden = [];
    const prioridad = (a, b) => (metodo === 'bola' ? a.saldo - b.saldo || b.tasaMes - a.tasaMes : b.tasaMes - a.tasaMes || a.saldo - b.saldo);
    while (ds.some(x => x.saldo > 0) && mes < 600) {
      mes++;
      for (const x of ds) if (x.saldo > 0) { const i = Math.round(x.saldo * x.tasaMes); x.saldo += i; interes += i; }
      let disp = soloMinimos ? Infinity : pago;
      for (const x of ds) if (x.saldo > 0) { const p = Math.min(x.minimo, x.saldo, disp); x.saldo -= p; disp -= p; }
      if (!soloMinimos) for (const x of ds.filter(x => x.saldo > 0).sort(prioridad)) { const p = Math.min(x.saldo, disp); x.saldo -= p; disp -= p; if (!disp) break; }
      for (const x of ds) if (x.saldo <= 0 && !orden.some(o => o.id === x.id)) orden.push({ id: x.id, nombre: x.nombre, mes });
    }
    return { meses: mes >= 600 ? null : mes, interes, orden, minTot, falta: 0 };
  }
  // A quién va el extra este mes según el método (la primera deuda viva en el orden de prioridad).
  const objetivoDeudas = (lista, metodo) => lista.slice().sort((a, b) => (metodo === 'bola' ? a.saldo - b.saldo : b.tasaMes - a.tasaMes))[0] || null;
  // ¿Me alcanza el sueldo? Ingreso del mes menos pagos fijos, cuotas de préstamos y lo que se debe en tarjetas.
  function alcanza(d, h) {
    const ing = ingresoMensual(d, h).monto;
    const fijos = vivas(d.fijos).filter(f => !f.pausado).reduce((s, f) => {
      const c = f.cuentaId && d.cuentas.find(x => x.id === f.cuentaId);
      return s + Math.round(aP(d, f.monto || 0, c ? c.moneda : d.ajustes.monedaPrincipal) * L.vecesAlMes(f.rec));
    }, 0);
    const ds = deudas(d), cuotas = ds.filter(x => x.tipo === 'prestamo').reduce((s, x) => s + x.minimo, 0);
    const tarjetas = ds.filter(x => x.tipo === 'tarjeta').reduce((s, x) => s + x.saldo, 0);
    const queda = ing - fijos - cuotas - tarjetas;
    return { ingreso: ing, fijos, cuotas, tarjetas, queda, nivel: !ing ? null : queda < 0 ? 'rojo' : queda < ing * 0.2 ? 'amarillo' : 'verde' };
  }
  // Dónde recortar: categorías que pasan lo sugerido por Mi plan (las 3 más grandes) y pagos fijos que son gustos.
  function recortes(d, h) {
    const p = plan(d, h);
    const cats = p.filas.filter(f => f.estado === 'pasado' && f.sugerido > 0).map(f => ({ id: f.id, grupo: f.grupo, propio: f.propio, real: f.real, sugerido: f.sugerido, ahorro: f.real - f.sugerido }))
      .sort((a, b) => b.ahorro - a.ahorro).slice(0, 3);
    const gustos = vivas(d.fijos).filter(f => !f.pausado && grupoDe(d, f.categoriaId) === 'deseos');
    const gustosMes = gustos.reduce((s, f) => s + Math.round((f.monto || 0) * L.vecesAlMes(f.rec)), 0);
    return { cats, gustos: gustos.length, gustosMes, total: cats.reduce((s, x) => s + x.ahorro, 0) };
  }

  // v24: Hogar: sueldo de cada uno, total y aporte justo a los pagos fijos (proporcional al sueldo o mitad y mitad).
  function hogar(d, h) {
    const ns = vivas(d.nominas), neto = n => Math.round(PL.nominaNeto(n, d.ajustes.pais).neto * L.vecesAlMes(n.rec));
    const yo = ns.filter(n => n.dueno !== 'pareja').reduce((s, n) => s + neto(n), 0), pareja = ns.filter(n => n.dueno === 'pareja').reduce((s, n) => s + neto(n), 0);
    const total = yo + pareja, mitad = (d.ajustes.hogar || {}).reparto === 'mitad';
    const pctYo = total ? (mitad ? 0.5 : yo / total) : 0.5, fijos = Object.values(fijosPorCat(d)).reduce((s, v) => s + v, 0);
    // Lo que puso cada uno este mes: pagos fijos según quién los paga (los de «los dos» se reparten) + gastos compartidos + lo saldado.
    const mes = (h || L.hoy()).slice(0, 7), porFijo = { yo: 0, pareja: 0, ambos: 0 };
    for (const f of vivas(d.fijos).filter(f => !f.pausado)) {
      const c = f.cuentaId && d.cuentas.find(x => x.id === f.cuentaId), v = L.aPrincipal(d, f.monto || 0, c ? c.moneda : d.ajustes.monedaPrincipal);
      porFijo[f.quien === 'pareja' ? 'pareja' : f.quien === 'ambos' ? 'ambos' : 'yo'] += Math.round((v == null ? f.monto || 0 : v) * L.vecesAlMes(f.rec));
    }
    const gs = vivas(d.hogarGastos).filter(g => (g.fecha || '').startsWith(mes)), comp = gs.filter(g => g.tipo !== 'saldar');
    const compYo = comp.reduce((s, g) => s + (g.yo || 0), 0), compPareja = comp.reduce((s, g) => s + (g.pareja || 0), 0);
    const ambosYo = Math.round(porFijo.ambos * pctYo);
    const gastoHogar = porFijo.yo + porFijo.pareja + porFijo.ambos + compYo + compPareja;
    const pusoYo = porFijo.yo + ambosYo + compYo, pusoPareja = porFijo.pareja + (porFijo.ambos - ambosYo) + compPareja;
    const saldado = gs.filter(g => g.tipo === 'saldar').reduce((s, g) => s + (g.yo || 0) - (g.pareja || 0), 0); // yo le pagué (+) o me pagó (−)
    const tocaYo = Math.round(gastoHogar * pctYo), balance = pusoYo + saldado - tocaYo; // > 0: la pareja me debe; < 0: le debo
    return { yo, pareja, total, pctYo, pctPareja: 1 - pctYo, fijos, aporteYo: Math.round(fijos * pctYo), aportePareja: fijos - Math.round(fijos * pctYo), mitad,
      mes, porFijo, compYo, compPareja, gastoHogar, pusoYo, pusoPareja, tocaYo, tocaPareja: gastoHogar - tocaYo, saldado, balance, gastos: comp };
  }
  const api = { hogar, compraHoy, rankingTarjetas, deudas, planDeudas, objetivoDeudas, alcanza, recortes, grupoDe, PERIODOS, saludPeriodo, REGLAS, NECESIDADES, DESEOS, CIUDADES, VIVIENDA, ingresoMensual, gastoPromedio, costoVida, recomendarRegla, plan, fondoEmergencia, proyeccionAhorro, LOGROS, logros };
  g.Consejos = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
