/* ============================================================================
   LaunchPad.dev — talks to YOUR server (server.js), which stores everything in MySQL.
   Nothing to configure: the site and the server live at the same address.
   ============================================================================ */
const TOKEN_KEY = 'lp_session_token'; // sessionStorage: cleared when the tab closes

async function api(method, path, body) {
  var headers = { 'Content-Type': 'application/json' };
  var token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  var r;
  try {
    r = await fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  } catch (netErr) {
    console.error('[LaunchPad] could not reach the server:', netErr);
    throw new Error('Could not reach the server. Check your internet connection and try again. (If this is your own computer, make sure the server is running.)');
  }
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) { var err = new Error(j.error || ('Request failed (' + r.status + ')')); err.status = r.status; throw err; }
  return j;
}

const LPBackend = {
  // Sign up: creates an UNVERIFIED account and emails a 6-digit code.
  startSignup: function (o) { return api('POST', '/api/auth/signup', { name: o.name, email: o.email, password: o.password, role: o.role || 'student', mentorRole: o.mentorRole || '', mentorLocation: o.mentorLocation || '' }); },
  resendCode: function (email) { return api('POST', '/api/auth/resend', { email: email }); },
  // The code proves the person owns the inbox; only then is a session issued.
  verifyEmail: async function (o) {
    var d = await api('POST', '/api/auth/verify', { email: o.email, code: o.code });
    sessionStorage.setItem(TOKEN_KEY, d.token);
    return d.user;
  },
  signIn: async function (o) {
    var d = await api('POST', '/api/auth/login', { email: o.email, password: o.password });
    sessionStorage.setItem(TOKEN_KEY, d.token);
    return d.user;
  },
  // Microsoft / Outlook: the browser is sent to the server, which handles Microsoft. Nothing secret lives here.
  startMicrosoftLogin: function () { window.location.href = '/api/auth/microsoft'; },
  completeMicrosoftLogin: async function (code) {
    var d = await api('POST', '/api/auth/microsoft/exchange', { code: code });
    sessionStorage.setItem(TOKEN_KEY, d.token);
    return d.user;
  },
  signOut: async function () {
    try { if (sessionStorage.getItem(TOKEN_KEY)) await api('POST', '/api/auth/logout'); } finally { sessionStorage.removeItem(TOKEN_KEY); }
  },
  // Call on page load to restore a session. Returns null if it has expired.
  getCurrentUser: async function () {
    if (!sessionStorage.getItem(TOKEN_KEY)) return null;
    try { return (await api('GET', '/api/auth/me')).user; }
    catch (e) { if (e.status === 401) { sessionStorage.removeItem(TOKEN_KEY); return null; } throw e; }
  },

  forgotPassword: function (email) { return api('POST', '/api/auth/forgot', { email: email }); },
  resetPassword: function (o) { return api('POST', '/api/auth/reset', { email: o.email, code: o.code, password: o.password }); },

  // Mentors (MySQL table `mentors`)
  listMentors: async function () { return (await api('GET', '/api/mentors')).mentors; },
  getMyMentor: async function () { return (await api('GET', '/api/mentors/me')).mentor; },
  saveMyMentor: function (m) {
    return api('PUT', '/api/mentors/me', { name: m.name, role: m.role, location: m.location, about: m.about || '', skills: m.skills || [], experience: m.experience || [],
      contactEmail: m.contactEmail || '', contactPhone: m.contactPhone || '', linkedin: m.linkedin || '', photo: m.photo || null });
  },
  deleteAccount: function () { return api('DELETE', '/api/account'); },

  // Contact details + contact form
  getSettings: function () { return api('GET', '/api/settings'); },
  sendContact: function (o) { return api('POST', '/api/contact', o); },

  // Admin panel
  admin: {
    overview: function () { return api('GET', '/api/admin/overview'); },
    users: function () { return api('GET', '/api/admin/users'); },
    mentors: function () { return api('GET', '/api/admin/mentors'); },
    payments: function () { return api('GET', '/api/admin/payments'); },
    messages: function () { return api('GET', '/api/admin/messages'); },
    deleteUser: function (id) { return api('DELETE', '/api/admin/users/' + id); },
    deleteMessage: function (id) { return api('DELETE', '/api/admin/messages/' + id); },
    saveSettings: function (s) { return api('PUT', '/api/admin/settings', s); },
  },

  getSubscription: function () { return api('GET', '/api/subscription'); },
  cancelSubscription: function () { return api('POST', '/api/subscription/cancel'); },
  startCheckout: async function (billing) { return (await api('POST', '/api/pay/checkout', { billing: billing })).url; },
  confirmPayment: function (reference) { return api('POST', '/api/pay/confirm', { reference: reference }); },
};
