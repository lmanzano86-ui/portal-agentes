/* Capa de datos del portal: Supabase en producción, localStorage en vista previa. */
let supa = null;
if (!MODO_DEMO && window.supabase) {
  supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* Almacenamiento: localStorage cuando se puede, memoria si el navegador lo bloquea */
const Memoria = (() => {
  let ok = false;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); ok = true; }
  catch (e) { ok = false; }
  const mem = {};
  return {
    get(k) { try { return ok ? localStorage.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return (k in mem ? mem[k] : null); } },
    set(k, v) { try { if (ok) localStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } },
    del(k) { try { if (ok) localStorage.removeItem(k); else delete mem[k]; } catch (e) { delete mem[k]; } }
  };
})();

/* ---------- Registro (crear cuenta) ---------- */
function traducirErrorAuth(msg) {
  if (/already registered|already exists/i.test(msg)) return 'Este correo ya está registrado. Entra con tu contraseña.';
  if (/password/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/email/i.test(msg)) return 'Revisa que el correo esté bien escrito.';
  return 'No se pudo crear tu cuenta. Intenta de nuevo.';
}

async function registrarse(nombre, email, password) {
  if (!nombre) throw new Error('Escribe tu nombre.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  if (MODO_DEMO) {
    const sesion = { id: 'demo-' + email.toLowerCase(), email, rol: 'agente', nombre };
    Memoria.set('portal_sesion', JSON.stringify(sesion));
    const ps = JSON.parse(Memoria.get('portal_perfiles') || '[]');
    if (!ps.find(p => p.id === sesion.id)) {
      ps.push({ id: sesion.id, email, nombre, rol: 'agente', activo: true, created_at: new Date().toISOString() });
      Memoria.set('portal_perfiles', JSON.stringify(ps));
    }
    return sesion;
  }
  const { data, error } = await supa.auth.signUp({
    email, password, options: { data: { nombre } }
  });
  if (error) throw new Error(traducirErrorAuth(error.message));
  const perfil = await obtenerPerfil(data.user.id);
  if (!perfil) throw new Error('Cuenta creada. Ahora entra con tu correo y contraseña.');
  if (!perfil.activo) {
    await supa.auth.signOut();
    throw new Error('Tu cuenta quedó pendiente de aprobación. Habla con tu director.');
  }
  return { id: data.user.id, email, rol: perfil.rol, nombre: perfil.nombre };
}

/* ---------- Sesión ---------- */
async function entrar(email, password) {
  if (MODO_DEMO) {
    if (password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
    const rol = email.toLowerCase() === 'admin@demo.com' ? 'admin' : 'agente';
    const sesion = {
      id: 'demo-' + email.toLowerCase(),
      email, rol,
      nombre: rol === 'admin' ? 'Lester (Admin)' : email.split('@')[0]
    };
    Memoria.set('portal_sesion', JSON.stringify(sesion));
    // Sembrar perfil en la lista del equipo (demo)
    const ps = JSON.parse(Memoria.get('portal_perfiles') || '[]');
    if (!ps.find(p => p.id === sesion.id)) {
      ps.push({ id: sesion.id, email, nombre: sesion.nombre, rol, activo: true, created_at: new Date().toISOString() });
      if (!ps.find(p => p.rol === 'agente' && p.id !== sesion.id)) {
        ps.push({ id: 'demo-agente-ejemplo', email: 'maria@ejemplo.com', nombre: 'María (ejemplo)', rol: 'agente', activo: true, created_at: new Date().toISOString() });
      }
      Memoria.set('portal_perfiles', JSON.stringify(ps));
    }
    return sesion;
  }
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Correo o contraseña incorrectos.');
  const perfil = await obtenerPerfil(data.user.id);
  if (!perfil || !perfil.activo) {
    await supa.auth.signOut();
    throw new Error('Tu cuenta está desactivada. Habla con tu director.');
  }
  return { id: data.user.id, email, rol: perfil.rol, nombre: perfil.nombre, pais: perfil.pais || null, comision_pct: perfil.comision_pct };
}

async function sesionActual() {
  if (MODO_DEMO) {
    const s = Memoria.get('portal_sesion');
    return s ? JSON.parse(s) : null;
  }
  const { data } = await supa.auth.getSession();
  if (!data.session) return null;
  const perfil = await obtenerPerfil(data.session.user.id);
  if (!perfil || !perfil.activo) { await supa.auth.signOut(); return null; }
  return { id: data.session.user.id, email: data.session.user.email, rol: perfil.rol, nombre: perfil.nombre, pais: perfil.pais || null, comision_pct: perfil.comision_pct };
}

async function salir() {
  if (MODO_DEMO) Memoria.del('portal_sesion');
  else await supa.auth.signOut();
}

async function obtenerPerfil(uid) {
  const { data } = await supa.from('perfiles').select('nombre, rol, activo, pais, comision_pct').eq('id', uid).single();
  return data;
}

/* ---------- Agentes e invitaciones (admin/director) ---------- */
function esAdmin(sesion) { return sesion && (sesion.rol === 'admin' || sesion.rol === 'director'); }

async function crearInvitacion(nombre, email, rol, pais, comision_pct) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Solo el administrador puede invitar agentes.');
  if (!pais) throw new Error('Selecciona el país donde trabajará el agente.');
  comision_pct = Number(comision_pct);
  if (!isFinite(comision_pct) || comision_pct < 0 || comision_pct > 100) {
    throw new Error('La comisión debe ser un porcentaje entre 0 y 100.');
  }
  const token = (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now() + Math.random().toString(16).slice(2));
  if (MODO_DEMO) {
    const invs = JSON.parse(Memoria.get('portal_invitaciones') || '[]');
    invs.unshift({ id: 'i' + Date.now(), email: email.toLowerCase(), nombre, rol, pais, comision_pct, token, usada: false, created_at: new Date().toISOString() });
    Memoria.set('portal_invitaciones', JSON.stringify(invs));
    return token;
  }
  const { error } = await supa.from('invitaciones').insert({
    email: email.toLowerCase(), nombre, rol, pais, comision_pct, token, creada_por: sesion.id
  });
  if (error) throw new Error('No se pudo crear la invitación.');
  return token;
}

function enlaceInvitacion(token) {
  const base = window.location.href.split('?')[0].replace(/[^/]*$/, '');
  return base + 'invitacion.html?t=' + encodeURIComponent(token);
}

async function listarAgentes() {
  if (MODO_DEMO) {
    return JSON.parse(Memoria.get('portal_perfiles') || '[]');
  }
  const { data } = await supa.from('perfiles').select('id, nombre, rol, activo, pais, comision_pct, created_at').order('created_at');
  return data || [];
}

async function cambiarActivoAgente(id, activo) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const ps = JSON.parse(Memoria.get('portal_perfiles') || '[]');
    const p = ps.find(x => x.id === id);
    if (p) { p.activo = activo; Memoria.set('portal_perfiles', JSON.stringify(ps)); }
    return;
  }
  const { error } = await supa.from('perfiles').update({ activo }).eq('id', id);
  if (error) throw new Error('No se pudo actualizar.');
}

async function listarInvitaciones() {
  if (MODO_DEMO) {
    return (JSON.parse(Memoria.get('portal_invitaciones') || '[]')).filter(i => !i.usada);
  }
  const { data } = await supa.from('invitaciones').select('id, email, nombre, rol, pais, comision_pct, token, created_at').eq('usada', false).order('created_at', { ascending: false });
  return data || [];
}

async function revocarInvitacion(id) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const invs = JSON.parse(Memoria.get('portal_invitaciones') || '[]').filter(i => i.id !== id);
    Memoria.set('portal_invitaciones', JSON.stringify(invs));
    return;
  }
  await supa.from('invitaciones').delete().eq('id', id);
}

/* ---------- Aceptar invitación (página pública) ---------- */
async function validarInvitacion(token) {
  if (MODO_DEMO) {
    const inv = (JSON.parse(Memoria.get('portal_invitaciones') || '[]'))
      .find(i => i.token === token && !i.usada);
    return inv ? { email: inv.email, nombre: inv.nombre, rol: inv.rol, pais: inv.pais || null, comision_pct: inv.comision_pct } : null;
  }
  const { data } = await supa.rpc('validar_invitacion', { p_token: token });
  return (data && data[0]) || null;
}

async function aceptarInvitacion(token, password) {
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const inv = await validarInvitacion(token);
  if (!inv) throw new Error('Invitación inválida o ya utilizada.');
  if (MODO_DEMO) {
    const invs = JSON.parse(Memoria.get('portal_invitaciones') || '[]');
    const ix = invs.findIndex(i => i.token === token);
    invs[ix].usada = true;
    Memoria.set('portal_invitaciones', JSON.stringify(invs));
    const ps = JSON.parse(Memoria.get('portal_perfiles') || '[]');
    const perfil = { id: 'demo-' + inv.email, email: inv.email, nombre: inv.nombre, rol: inv.rol, pais: inv.pais || null, comision_pct: inv.comision_pct, activo: true, created_at: new Date().toISOString() };
    ps.push(perfil);
    Memoria.set('portal_perfiles', JSON.stringify(ps));
    Memoria.set('portal_sesion', JSON.stringify({ id: perfil.id, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, pais: perfil.pais, comision_pct: perfil.comision_pct }));
    return perfil;
  }
  const { data, error } = await supa.auth.signUp({
    email: inv.email,
    password,
    options: { data: { nombre: inv.nombre } }
  });
  if (error) throw new Error('No se pudo crear tu cuenta. Intenta de nuevo.');
  return data.user;
}

/* ---------- Solicitudes ---------- */

/* Valida que sea un enlace de Google (Maps o perfil del negocio). */
function validarEnlaceGoogle(url) {
  const u = String(url || '').trim();
  if (!u) return { ok: false, msg: 'Pega el enlace del perfil de Google del negocio.' };
  let p;
  try { p = new URL(u); }
  catch (e) { return { ok: false, msg: 'No parece un enlace válido. Pégalo completo, con https://' }; }
  if (!/^https?:$/.test(p.protocol)) return { ok: false, msg: 'El enlace debe empezar con https://' };
  const host = p.hostname.toLowerCase();
  const esGoogle = /(^|\.)google\.com$/.test(host) || /(^|\.)goo\.gl$/.test(host) ||
    host === 'g.page' || /(^|\.)g\.page$/.test(host) || host === 'maps.app.goo.gl';
  if (!esGoogle) return { ok: false, msg: 'Debe ser un enlace de Google (Maps o perfil del negocio).' };
  if (/google\.com$/.test(host) && !/^(maps|www)\./.test(host) && !p.pathname.startsWith('/maps')) {
    return { ok: false, msg: 'Debe ser un enlace de Google Maps o del perfil del negocio.' };
  }
  return { ok: true, msg: '✓ Enlace válido.', url: p.href };
}

/* Valida un enlace cualquiera de sitio web (vacío = válido, es opcional). */
function validarUrlSitio(url) {
  const u = String(url || '').trim();
  if (!u) return { ok: true, vacio: true, url: '' };
  let p;
  try { p = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : 'https://' + u); }
  catch (e) { return { ok: false, msg: 'El enlace de la página web no parece válido.' }; }
  if (!/^https?:$/.test(p.protocol)) return { ok: false, msg: 'El enlace de la página web debe empezar con https://' };
  return { ok: true, vacio: false, url: p.href };
}

async function crearSolicitud(datos) {
  const sesion = await sesionActual();
  if (!sesion) throw new Error('Sesión vencida. Entra de nuevo.');
  const vGoogle = validarEnlaceGoogle(datos.enlace_google);
  if (!vGoogle.ok) throw new Error(vGoogle.msg);
  datos.enlace_google = vGoogle.url;
  const vWeb = validarUrlSitio(datos.web_actual);
  if (!vWeb.ok) throw new Error(vWeb.msg);
  datos.web_actual = vWeb.url;
  const estadosWeb = ['sin web', 'actualizada', 'obsoleta'];
  if (!estadosWeb.includes(datos.estado_web)) throw new Error('Indica si el negocio tiene página web.');
  if (datos.web_actual && datos.estado_web === 'sin web') throw new Error('Pegaste el enlace de la web pero marcaste "No tiene página web".');
  if (!datos.web_actual && datos.estado_web !== 'sin web') throw new Error('Marcaste que tiene página web pero no pegaste el enlace.');
  const fila = { ...datos, agente_id: sesion.id, agente_nombre: sesion.nombre, estado: 'nueva', created_at: new Date().toISOString() };
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    fila.id = 'demo-' + Date.now();
    todas.unshift(fila);
    Memoria.set('portal_solicitudes', JSON.stringify(todas));
    return fila;
  }
  const { error } = await supa.from('solicitudes').insert({
    agente_id: sesion.id, agente_nombre: sesion.nombre, pais: datos.pais, nombre_negocio: datos.nombre_negocio,
    giro: datos.giro, direccion: datos.direccion, telefono: datos.telefono,
    horario: datos.horario, servicios: datos.servicios, instagram: datos.instagram,
    facebook: datos.facebook, web_actual: datos.web_actual, enlace_google: datos.enlace_google,
    plan_interes: datos.plan_interes, notas: datos.notas, estado: 'nueva', estado_web: datos.estado_web
  });
  if (error) throw new Error('No se pudo guardar. Intenta de nuevo.');
  return fila;
}

async function listarSolicitudes() {
  const sesion = await sesionActual();
  if (!sesion) return [];
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    const semilla = JSON.parse(Memoria.get('portal_semilla') || 'null');
    let base = todas;
    if (!semilla) {
      base = [
        { id: 's1', nombre_negocio: 'Taquería El Faro', giro: 'Restaurante mexicano', pais: 'Estados Unidos', telefono: '+1 8135550100', estado: 'demo lista', agente_nombre: 'maria', created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 's2', nombre_negocio: 'Barbearia Corte Fino', giro: 'Barbería', pais: 'Brasil', telefono: '+55 45991234567', estado: 'nueva', agente_nombre: 'maria', created_at: new Date().toISOString() }
      ];
      Memoria.set('portal_semilla', '1');
      Memoria.set('portal_solicitudes', JSON.stringify(base));
    }
    return sesion.rol === 'agente' ? base.filter(s => s.agente_id === sesion.id || s.agente_nombre === sesion.nombre) : base;
  }
  let q = supa.from('solicitudes').select('*').order('created_at', { ascending: false });
  if (sesion.rol === 'agente') q = q.eq('agente_id', sesion.id);
  const { data } = await q;
  return data || [];
}
