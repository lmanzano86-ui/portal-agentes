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
  let session = null;
  try {
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (e) {
    // Error transitorio (red): no cerrar sesión, solo reportar null temporal.
    // Quien llama debe distinguir: null aquí puede ser "sin sesión" o "sin red".
    return null;
  }
  if (!session) return null;
  let perfil = null;
  try {
    perfil = await obtenerPerfil(session.user.id);
  } catch (e) {
    // Fallo al leer el perfil (red o BD): mantener la sesión de Auth,
    // devolver sesión parcial marcada para que la UI lo indique.
    return { id: session.user.id, email: session.user.email, rol: null, nombre: session.user.email, _perfilError: true };
  }
  if (!perfil) {
    // Perfil realmente inexistente: limpiar sesión huérfana.
    try { await supa.auth.signOut(); } catch (e) {}
    return null;
  }
  if (!perfil.activo) {
    try { await supa.auth.signOut(); } catch (e) {}
    return null;
  }
  return { id: session.user.id, email: session.user.email, rol: perfil.rol, nombre: perfil.nombre, pais: perfil.pais || null, comision_pct: perfil.comision_pct };
}

async function salir() {
  if (MODO_DEMO) Memoria.del('portal_sesion');
  else await supa.auth.signOut();
}

async function obtenerPerfil(uid) {
  const { data, error } = await supa.from('perfiles').select('nombre, rol, activo, pais, comision_pct').eq('id', uid).single();
  if (error) {
    // Distinguir "no existe" (PGRST116) de un fallo real.
    if (error.code === 'PGRST116') return null;
    throw new Error('No se pudo leer tu perfil: ' + (error.message || 'error de red'));
  }
  return data;
}

/* ---------- Agentes e invitaciones (admin/director) ---------- */
function esAdmin(sesion) { return sesion && (sesion.rol === 'admin' || sesion.rol === 'director'); }

async function crearInvitacion(nombre, email, rol, pais, comision_pct) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Solo el administrador puede invitar agentes.');
  nombre = (nombre || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!nombre) throw new Error('Escribe el nombre del agente.');
  if (!/.+@.+\..+/.test(email)) throw new Error('Revisa el correo electrónico.');
  if (!['agente', 'director'].includes(rol)) throw new Error('Rol inválido.');
  if (!pais) throw new Error('Selecciona el país donde trabajará el agente.');
  comision_pct = Number(comision_pct);
  if (!isFinite(comision_pct) || comision_pct < 0 || comision_pct > 100) {
    throw new Error('La comisión debe ser un porcentaje entre 0 y 100.');
  }
  // Evitar invitaciones duplicadas activas para el mismo correo.
  const existentes = await listarInvitaciones();
  if (existentes.some(i => (i.email || '').toLowerCase() === email)) {
    throw new Error('Ya hay una invitación activa para ese correo. Revócala primero si quieres crear otra.');
  }
  const token = (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now() + Math.random().toString(16).slice(2));
  const expira_en = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  if (MODO_DEMO) {
    const invs = JSON.parse(Memoria.get('portal_invitaciones') || '[]');
    invs.unshift({ id: 'i' + Date.now(), email, nombre, rol, pais, comision_pct, token, usada: false, expira_en, created_at: new Date().toISOString() });
    Memoria.set('portal_invitaciones', JSON.stringify(invs));
    return token;
  }
  const { error } = await supa.from('invitaciones').insert({
    email, nombre, rol, pais, comision_pct, token, creada_por: sesion.id, expira_en
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

function invitacionVigente(inv) {
  if (!inv || inv.usada) return false;
  if (!inv.expira_en) return true; // invitaciones viejas sin fecha: se consideran vigentes
  return new Date(inv.expira_en).getTime() > Date.now();
}

async function listarInvitaciones() {
  if (MODO_DEMO) {
    return (JSON.parse(Memoria.get('portal_invitaciones') || '[]')).filter(invitacionVigente);
  }
  const { data } = await supa.from('invitaciones')
    .select('id, email, nombre, rol, pais, comision_pct, token, expira_en, creada_por, created_at')
    .eq('usada', false)
    .gt('expira_en', new Date().toISOString())
    .order('created_at', { ascending: false });
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

/* ----- Usuarios de sistema (solo la cuenta de Lester) ----- */
const ID_LESTER = '3def5e8b-ec08-4f3c-84a7-20b34de859d8';
const EMAIL_SISTEMA_EN_USO = 'sistema@portal-agentes.local';

/* ---------- Crear y editar usuarios manualmente (solo admin) ----------
   Usa la Auth Admin API de Supabase a través de las funciones
   admin_auth_request / admin_auth_result (migración 2026-10-11).
   La service_role vive en el Vault de la BD; nunca sale al navegador. */
function esAdminTotal(sesion) { return sesion && sesion.rol === 'admin'; }

async function adminAuthCall(method, path, body) {
  const sesion = await sesionActual();
  if (!esAdminTotal(sesion)) throw new Error('Solo el administrador.');
  const { data: reqId, error: e1 } = await supa.rpc('admin_auth_request', {
    p_method: method, p_path: path, p_body: body || {}
  });
  if (e1) throw new Error(e1.message || 'No se pudo contactar el servidor.');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const { data, error: e2 } = await supa.rpc('admin_auth_result', { p_request_id: reqId });
    if (e2) throw new Error(e2.message || 'No se pudo leer la respuesta.');
    if (data && !data.pending) {
      if (data.status >= 200 && data.status < 300) return data.body;
      const b = data.body || {};
      throw new Error(b.msg || b.message || b.error_description || ('Error del servidor (' + data.status + ')'));
    }
  }
  throw new Error('El servidor no respondió a tiempo. Revisa la lista del equipo.');
}

/* Crea la cuenta ya confirmada y con todas sus características.
   Reutiliza la invitación para que el trigger le asigne rol/país/comisión. */
async function adminCrearUsuario({ nombre, email, password, rol, pais, comision_pct }) {
  nombre = (nombre || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!nombre) throw new Error('Escribe el nombre.');
  if (!/.+@.+\..+/.test(email)) throw new Error('Revisa el correo.');
  if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  if (!['agente', 'director', 'admin'].includes(rol)) throw new Error('Rol inválido.');
  // La invitación valida país y comisión, y el trigger la usa para crear el perfil.
  const token = await crearInvitacion(nombre, email, rol, pais, comision_pct);
  try {
    const user = await adminAuthCall('POST', '/auth/v1/admin/users', {
      email, password, email_confirm: true,
      user_metadata: { nombre }
    });
    return user;
  } catch (e) {
    // Si la cuenta no se creó, se revoca la invitación para no dejar basura.
    try {
      const invs = await listarInvitaciones();
      const inv = invs.find(i => i.token === token);
      if (inv) await revocarInvitacion(inv.id);
    } catch (_) { /* best effort */ }
    throw e;
  }
}

async function adminListarAgentes() {
  const sesion = await sesionActual();
  if (!esAdminTotal(sesion)) throw new Error('Solo el administrador.');
  const { data, error } = await supa.rpc('admin_listar_agentes');
  if (error) throw new Error(error.message || 'No se pudo listar el equipo.');
  return data || [];
}

/* Edita las características del perfil (nombre, rol, país, comisión, activo). */
async function adminEditarPerfil(id, campos) {
  const sesion = await sesionActual();
  if (!esAdminTotal(sesion)) throw new Error('Solo el administrador.');
  const permitido = {};
  if (campos.nombre != null) permitido.nombre = String(campos.nombre).trim();
  if (['agente', 'director', 'admin'].includes(campos.rol)) permitido.rol = campos.rol;
  if (campos.pais !== undefined) permitido.pais = campos.pais || null;
  if (campos.comision_pct !== undefined && campos.comision_pct !== null && campos.comision_pct !== '') {
    const c = Number(campos.comision_pct);
    if (!isFinite(c) || c < 0 || c > 100) throw new Error('La comisión debe ser un porcentaje entre 0 y 100.');
    permitido.comision_pct = c;
  }
  if (typeof campos.activo === 'boolean') permitido.activo = campos.activo;
  if (!Object.keys(permitido).length) throw new Error('Nada que guardar.');
  if (permitido.nombre === '') throw new Error('El nombre no puede quedar vacío.');
  const { error } = await supa.from('perfiles').update(permitido).eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo guardar.');
}

async function adminCambiarEmail(id, email) {
  email = (email || '').trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) throw new Error('Revisa el correo.');
  await adminAuthCall('PUT', '/auth/v1/admin/users/' + id, { email });
}

async function adminCambiarPassword(id, password) {
  if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  await adminAuthCall('PUT', '/auth/v1/admin/users/' + id, { password });
}

async function adminEliminarUsuario(id) {
  const sesion = await sesionActual();
  if (!esAdminTotal(sesion)) throw new Error('Solo el administrador.');
  if (id === sesion.id) throw new Error('No puedes eliminar tu propia cuenta.');
  await adminAuthCall('DELETE', '/auth/v1/admin/users/' + id);
  await supa.from('perfiles').delete().eq('id', id);
}

async function listarUsuariosSistema() {
  if (MODO_DEMO) return [];
  const { data, error } = await supa.rpc('listar_usuarios_sistema');
  if (error) throw new Error('No se pudieron listar los usuarios de sistema.');
  return data || [];
}

async function eliminarUsuarioSistema(id) {
  if (MODO_DEMO) return;
  const { error } = await supa.rpc('eliminar_usuario_sistema', { p_user_id: id });
  if (error) throw new Error(error.message || 'No se pudo eliminar.');
}

/* ---------- Aceptar invitación (página pública) ---------- */
async function validarInvitacion(token) {
  if (MODO_DEMO) {
    const inv = (JSON.parse(Memoria.get('portal_invitaciones') || '[]'))
      .find(i => i.token === token && invitacionVigente(i));
    return inv ? { email: inv.email, nombre: inv.nombre, rol: inv.rol, pais: inv.pais || null, comision_pct: inv.comision_pct } : null;
  }
  const { data } = await supa.rpc('validar_invitacion', { p_token: token });
  const inv = (data && data[0]) || null;
  // El RPC valida existencia y uso; aquí reforzamos expiración por si el RPC no la checa.
  if (inv && inv.expira_en && new Date(inv.expira_en).getTime() <= Date.now()) return null;
  return inv;
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
  if (error) throw new Error(traducirErrorAuth(error.message));
  if (!data.session) {
    // "Confirm email" está activado en el proyecto: la cuenta se creó
    // pero el agente debe confirmar su correo antes de entrar.
    throw new Error('Cuenta creada. Revisa tu correo para confirmarla y luego entra con tu contraseña. Si no ves el correo, avísale a tu administrador.');
  }
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

async function listarSolicitudes(sesion) {
  if (!sesion) sesion = await sesionActual();
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

/* Marca un negocio como cerrado (venta concretada) o lo revierte. */
async function marcarCierre(id, cerrado) {
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    const s = todas.find(x => x.id === id);
    if (s) { s.cerrado = cerrado; s.cerrado_en = cerrado ? new Date().toISOString() : null; }
    Memoria.set('portal_solicitudes', JSON.stringify(todas));
    return;
  }
  const { error } = await supa.from('solicitudes').update({
    cerrado,
    cerrado_en: cerrado ? new Date().toISOString() : null
  }).eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo actualizar.');
}

/* ---------- Pipeline de estados (U1) ---------- */
const ESTADOS_SOLICITUD = ['nueva', 'en revisión', 'demo lista', 'publicada', 'descartada'];

async function cambiarEstadoSolicitud(id, nuevoEstado) {
  if (!ESTADOS_SOLICITUD.includes(nuevoEstado)) throw new Error('Estado inválido.');
  const sesion = await sesionActual();
  if (!sesion) throw new Error('Sesión vencida. Entra de nuevo.');
  // Solo director/admin pueden mover el pipeline (el RLS lo refuerza en la BD).
  if (!['admin', 'director'].includes(sesion.rol)) throw new Error('Solo tu director puede cambiar el estado.');
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    const s = todas.find(x => x.id === id);
    if (!s) throw new Error('Solicitud no encontrada.');
    const antes = s.estado;
    s.estado = nuevoEstado;
    s.updated_at = new Date().toISOString();
    Memoria.set('portal_solicitudes', JSON.stringify(todas));
    registrarAuditoria('cambio_estado', 'solicitudes', id, { estado: antes }, { estado: nuevoEstado });
    return;
  }
  const antes = await supa.from('solicitudes').select('estado').eq('id', id).single();
  const { error } = await supa.from('solicitudes').update({ estado: nuevoEstado }).eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo cambiar el estado.');
  registrarAuditoria('cambio_estado', 'solicitudes', id,
    { estado: antes && antes.data ? antes.data.estado : null }, { estado: nuevoEstado });
}

/* ---------- Editar solicitud (F8) ---------- */
async function editarSolicitud(id, datos) {
  const sesion = await sesionActual();
  if (!sesion) throw new Error('Sesión vencida. Entra de nuevo.');
  if (datos.enlace_google !== undefined) {
    const v = validarEnlaceGoogle(datos.enlace_google);
    if (!v.ok) throw new Error(v.msg);
    datos.enlace_google = v.url;
  }
  if (datos.web_actual !== undefined) {
    const v = validarUrlSitio(datos.web_actual);
    if (!v.ok) throw new Error(v.msg);
    datos.web_actual = v.url;
  }
  // El agente solo edita sus propias solicitudes y nunca el estado/cierre.
  delete datos.estado; delete datos.cerrado; delete datos.cerrado_en;
  delete datos.agente_id; delete datos.agente_nombre;
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    const s = todas.find(x => x.id === id);
    if (!s) throw new Error('Solicitud no encontrada.');
    if (sesion.rol === 'agente' && s.agente_id !== sesion.id && s.agente_nombre !== sesion.nombre)
      throw new Error('Solo puedes editar tus propias solicitudes.');
    Object.assign(s, datos, { updated_at: new Date().toISOString() });
    Memoria.set('portal_solicitudes', JSON.stringify(todas));
    return s;
  }
  let q = supa.from('solicitudes').update(datos).eq('id', id);
  if (sesion.rol === 'agente') q = q.eq('agente_id', sesion.id);
  const { error } = await q;
  if (error) throw new Error(error.message || 'No se pudo guardar.');
}

/* ---------- Recuperación de contraseña (F5) ---------- */
async function recuperarPassword(email) {
  email = (email || '').trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) throw new Error('Escribe un correo válido.');
  if (MODO_DEMO) return true; // en demo no hay email real
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split('?')[0].replace(/[^/]*$/, '') + 'index.html'
  });
  // Mensaje genérico: no revelar si el correo existe (S-seguridad).
  if (error) throw new Error('No se pudo enviar el correo. Intenta de nuevo.');
  return true;
}

/* ---------- Sistema de comisiones por niveles ---------- */
const NIVELES_COMISION = [
  { pct: 35, ventas: 0,  etiqueta: 'Inicio' },
  { pct: 40, ventas: 3,  etiqueta: '3 ventas' },
  { pct: 50, ventas: 5,  etiqueta: '5 ventas' },
  { pct: 60, ventas: 8,  etiqueta: '8 ventas' },
  { pct: 70, ventas: 10, etiqueta: '10 ventas + 1 recluta con 3 ventas', requiereRecluta: true },
];

function calcularNivel(ventas, reclutasValidos) {
  if (ventas >= 10 && reclutasValidos >= 1) return 70;
  if (ventas >= 8) return 60;
  if (ventas >= 5) return 50;
  if (ventas >= 3) return 40;
  return 35;
}

/* Devuelve { ventas, nivel, siguiente, faltanVentas, reclutas, reclutasValidos, faltaRecluta } */
async function progresoComision(agenteId) {
  const sesion = await sesionActual();
  const id = agenteId || (sesion && sesion.id);
  if (!id) throw new Error('Sin sesión.');
  let ventas = 0, reclutas = [];
  if (MODO_DEMO) {
    const todas = JSON.parse(Memoria.get('portal_solicitudes') || '[]');
    ventas = todas.filter(s => s.cerrado && (s.agente_id === id || s.agente_nombre === (sesion && sesion.nombre))).length;
    const ps = JSON.parse(Memoria.get('portal_perfiles') || '[]');
    reclutas = ps.filter(p => p.reclutado_por === id).map(p => ({
      id: p.id, nombre: p.nombre,
      ventas: todas.filter(s => s.cerrado && s.agente_id === p.id).length
    }));
  } else {
    const { data, error } = await supa.rpc('stats_agente', { p_agente_id: id });
    if (error) throw new Error('No se pudieron cargar tus ventas.');
    ventas = (data && data.ventas) || 0;
    reclutas = (data && data.reclutas) || [];
  }
  const reclutasValidos = reclutas.filter(r => r.ventas >= 3).length;
  const nivel = calcularNivel(ventas, reclutasValidos);
  const idx = NIVELES_COMISION.findIndex(n => n.pct === nivel);
  const siguiente = NIVELES_COMISION[idx + 1] || null;
  let faltanVentas = 0, faltaRecluta = false, detalle = '';
  if (siguiente) {
    faltanVentas = Math.max(0, siguiente.ventas - ventas);
    if (siguiente.requiereRecluta) {
      faltaRecluta = reclutasValidos < 1;
      const partes = [];
      if (faltanVentas > 0) partes.push('te faltan ' + faltanVentas + ' venta' + (faltanVentas === 1 ? '' : 's') + ' propia' + (faltanVentas === 1 ? '' : 's'));
      if (faltaRecluta) {
        const mejor = reclutas.length ? Math.max.apply(null, reclutas.map(r => r.ventas)) : 0;
        partes.push(reclutas.length
          ? 'tu mejor recluta lleva ' + mejor + '/3 ventas'
          : 'aún no tienes reclutas en tu equipo');
      }
      detalle = partes.length ? 'Para el 70%: ' + partes.join(' y ') + '.' : '¡Listo para el 70%!';
    } else {
      detalle = faltanVentas > 0
        ? 'Te faltan ' + faltanVentas + ' venta' + (faltanVentas === 1 ? '' : 's') + ' para el ' + siguiente.pct + '%.'
        : '¡Nivel alcanzado!';
    }
  }
  return { ventas, nivel, siguiente, faltanVentas, reclutas, reclutasValidos, faltaRecluta, detalle };
}

/* ---------- Auditoría (F2) ---------- */
async function registrarAuditoria(accion, tabla, registro_id, antes, despues) {
  try {
    const sesion = await sesionActual().catch(() => null);
    const entry = {
      actor_id: sesion ? sesion.id : null,
      actor_nombre: sesion ? sesion.nombre : null,
      accion, tabla, registro_id: String(registro_id || ''),
      antes: antes || null, despues: despues || null,
      created_at: new Date().toISOString()
    };
    if (MODO_DEMO) {
      const log = JSON.parse(Memoria.get('portal_audit') || '[]');
      log.unshift(entry);
      Memoria.set('portal_audit', JSON.stringify(log.slice(0, 500)));
      return;
    }
    await supa.from('audit_log').insert({
      actor_id: entry.actor_id, accion, tabla,
      registro_id: entry.registro_id, antes: entry.antes, despues: entry.despues
    });
  } catch (e) { /* la auditoría nunca debe romper la acción principal */ }
}

async function listarAuditoria(limite) {
  limite = limite || 100;
  if (MODO_DEMO) return (JSON.parse(Memoria.get('portal_audit') || '[]')).slice(0, limite);
  const sesion = await sesionActual();
  if (!sesion || sesion.rol !== 'admin') throw new Error('Solo el administrador.');
  const { data, error } = await supa.from('audit_log')
    .select('*').order('created_at', { ascending: false }).limit(limite);
  if (error) throw new Error('No se pudo leer la auditoría.');
  return data || [];
}

/* ---------- Demos: secciones por país + tarjetas ---------- */
const DEMOS_PAISES_SEED = [
  { id: 'dp-us', nombre: 'Estados Unidos', orden: 1, activo: true },
  { id: 'dp-es', nombre: 'España', orden: 2, activo: true },
  { id: 'dp-br', nombre: 'Brasil', orden: 3, activo: true },
  { id: 'dp-nl', nombre: 'Países Bajos', orden: 4, activo: true }
];

function _demosMem() {
  let paises = JSON.parse(Memoria.get('portal_demos_paises') || 'null');
  if (!paises) { paises = DEMOS_PAISES_SEED.slice(); Memoria.set('portal_demos_paises', JSON.stringify(paises)); }
  const demos = JSON.parse(Memoria.get('portal_demos') || '[]');
  return { paises, demos };
}
function _demosMemGuardar(paises, demos) {
  Memoria.set('portal_demos_paises', JSON.stringify(paises));
  Memoria.set('portal_demos', JSON.stringify(demos));
}

async function listarPaisesDemo() {
  if (MODO_DEMO) return _demosMem().paises.filter(p => p.activo).sort((a, b) => a.orden - b.orden);
  const { data, error } = await supa.from('demos_paises').select('*').eq('activo', true).order('orden');
  if (error) throw new Error('No se pudieron cargar los países.');
  return data || [];
}

async function listarTodosPaisesDemo() {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) return _demosMem().paises.sort((a, b) => a.orden - b.orden);
  const { data, error } = await supa.from('demos_paises').select('*').order('orden');
  if (error) throw new Error('No se pudieron cargar los países.');
  return data || [];
}

async function crearPaisDemo(nombre) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  nombre = (nombre || '').trim();
  if (!nombre) throw new Error('Escribe el nombre del país.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    if (paises.some(p => p.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error('Ese país ya existe.');
    const maxOrden = paises.reduce((m, p) => Math.max(m, p.orden || 0), 0);
    paises.push({ id: 'dp-' + Date.now(), nombre, orden: maxOrden + 1, activo: true });
    _demosMemGuardar(paises, demos);
    return;
  }
  const { data: ex } = await supa.from('demos_paises').select('orden').order('orden', { ascending: false }).limit(1);
  const orden = ex && ex[0] ? (ex[0].orden || 0) + 1 : 1;
  const { error } = await supa.from('demos_paises').insert({ nombre, orden });
  if (error) throw new Error(error.code === '23505' ? 'Ese país ya existe.' : 'No se pudo crear el país.');
}

async function editarPaisDemo(id, campos) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    const p = paises.find(x => x.id === id);
    if (!p) throw new Error('País no encontrado.');
    if (campos.nombre !== undefined) {
      const nombre = (campos.nombre || '').trim();
      if (!nombre) throw new Error('Escribe el nombre del país.');
      if (paises.some(x => x.id !== id && x.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error('Ese país ya existe.');
      p.nombre = nombre;
    }
    if (campos.activo !== undefined) p.activo = !!campos.activo;
    _demosMemGuardar(paises, demos);
    return;
  }
  const permitido = {};
  if (campos.nombre !== undefined) permitido.nombre = (campos.nombre || '').trim();
  if (campos.activo !== undefined) permitido.activo = !!campos.activo;
  const { error } = await supa.from('demos_paises').update(permitido).eq('id', id);
  if (error) throw new Error(error.code === '23505' ? 'Ese país ya existe.' : 'No se pudo guardar.');
}

async function eliminarPaisDemo(id) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    _demosMemGuardar(paises.filter(p => p.id !== id), demos.filter(d => d.pais_id !== id));
    return;
  }
  const { error } = await supa.from('demos_paises').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar el país.');
}

async function listarDemos(paisId) {
  if (MODO_DEMO) {
    let demos = _demosMem().demos.filter(d => d.activo);
    if (paisId) demos = demos.filter(d => d.pais_id === paisId);
    return demos.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }
  let q = supa.from('demos').select('*, demos_paises(nombre)').eq('activo', true).order('orden');
  if (paisId) q = q.eq('pais_id', paisId);
  const { data, error } = await q;
  if (error) throw new Error('No se pudieron cargar los demos.');
  return (data || []).map(d => ({ ...d, pais_nombre: d.demos_paises ? d.demos_paises.nombre : '' }));
}

async function crearDemo(datos) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  const titulo = (datos.titulo || '').trim();
  const url = (datos.url || '').trim();
  if (!titulo) throw new Error('Escribe el título del demo.');
  if (!url) throw new Error('Pega la URL del demo.');
  if (!datos.pais_id) throw new Error('Selecciona el país.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    const maxOrden = demos.filter(d => d.pais_id === datos.pais_id).reduce((m, d) => Math.max(m, d.orden || 0), 0);
    demos.push({
      id: 'd' + Date.now(), pais_id: datos.pais_id, titulo, url,
      descripcion: (datos.descripcion || '').trim() || null,
      imagen_url: (datos.imagen_url || '').trim() || null,
      orden: maxOrden + 1, activo: true, created_at: new Date().toISOString()
    });
    _demosMemGuardar(paises, demos);
    return;
  }
  const { data: ex } = await supa.from('demos').select('orden').eq('pais_id', datos.pais_id).order('orden', { ascending: false }).limit(1);
  const orden = ex && ex[0] ? (ex[0].orden || 0) + 1 : 1;
  const { error } = await supa.from('demos').insert({
    pais_id: datos.pais_id, titulo, url,
    descripcion: (datos.descripcion || '').trim() || null,
    imagen_url: (datos.imagen_url || '').trim() || null, orden
  });
  if (error) throw new Error('No se pudo crear el demo.');
}

async function editarDemo(id, campos) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    const d = demos.find(x => x.id === id);
    if (!d) throw new Error('Demo no encontrado.');
    ['titulo', 'url', 'descripcion', 'imagen_url', 'pais_id'].forEach(k => {
      if (campos[k] !== undefined) d[k] = (campos[k] || '').trim() || (k === 'titulo' || k === 'url' ? d[k] : null);
    });
    if (campos.activo !== undefined) d.activo = !!campos.activo;
    if (!d.titulo) throw new Error('Escribe el título del demo.');
    if (!d.url) throw new Error('Pega la URL del demo.');
    _demosMemGuardar(paises, demos);
    return;
  }
  const permitido = {};
  ['titulo', 'url', 'descripcion', 'imagen_url', 'pais_id'].forEach(k => {
    if (campos[k] !== undefined) permitido[k] = (campos[k] || '').trim() || null;
  });
  if (campos.activo !== undefined) permitido.activo = !!campos.activo;
  if (permitido.titulo !== undefined && !permitido.titulo) throw new Error('Escribe el título del demo.');
  if (permitido.url !== undefined && !permitido.url) throw new Error('Pega la URL del demo.');
  const { error } = await supa.from('demos').update(permitido).eq('id', id);
  if (error) throw new Error('No se pudo guardar.');
}

async function eliminarDemo(id) {
  const sesion = await sesionActual();
  if (!esAdmin(sesion)) throw new Error('Sin permiso.');
  if (MODO_DEMO) {
    const { paises, demos } = _demosMem();
    _demosMemGuardar(paises, demos.filter(d => d.id !== id));
    return;
  }
  const { error } = await supa.from('demos').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar el demo.');
}
