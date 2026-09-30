(function () {
  'use strict';

  var screens = ['home', 'signin', 'signup', 'forgot', 'verify', 'about', 'contact', 'cv-builder', 'interview', 'mentors', 'mentor', 'mentor-dashboard', 'profile', 'subscription', 'payment', 'admin'];
  var loggedIn = false;

  // Routes anyone can see without signing in. Everything else — every real
  // feature — requires an account first.
  var PUBLIC_ROUTES = ['home', 'signin', 'signup', 'forgot', 'verify', 'about', 'contact'];
  var pendingRoute = null; // where to send them once they've signed in

  /* ---------------------------------------------
     Local "database" — users, current session, subscription, bookings
     (All localStorage. No backend — this is a frontend-only demo.)
  --------------------------------------------- */
  function loadUsers() { return JSON.parse(localStorage.getItem('lp_users') || '[]'); }
  function saveUsers(list) { localStorage.setItem('lp_users', JSON.stringify(list)); }
  function findUserByEmail(email) {
    return loadUsers().find(function (u) { return u.email.toLowerCase() === email.toLowerCase(); });
  }

  var currentUser = JSON.parse(localStorage.getItem('lp_current_user') || 'null');

  // A saved login is only trusted if a real server session token backs it.
  // This wipes the fake "Outlook User" (and any other stale login) left by the old demo version.
  (function purgeStaleLogin() {
    var hasToken = !!sessionStorage.getItem('lp_session_token');
    if (!hasToken) { currentUser = null; localStorage.removeItem('lp_current_user'); }
    try {
      var kept = loadUsers().filter(function (u) { return u.email && u.email.toLowerCase() !== 'outlook.user@outlook.com'; });
      saveUsers(kept);
    } catch (e) {}
  })();
  var subscription = JSON.parse(localStorage.getItem('lp_subscription') || 'null') || { plan: 'free', billing: 'monthly' };
  var bookings = JSON.parse(localStorage.getItem('lp_bookings') || '[]');

  function saveSubscription() { localStorage.setItem('lp_subscription', JSON.stringify(subscription)); }
  function saveBookings() { localStorage.setItem('lp_bookings', JSON.stringify(bookings)); }
  function saveCurrentUser() { localStorage.setItem('lp_current_user', JSON.stringify(currentUser)); }

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  /* ---------------------------------------------
     Mentors data (shared by Home, Mentor Profile, Booking)
  --------------------------------------------- */
  var mentors = [
    {
      id: 'qshandu', name: 'Qhubekani Shandu', role: 'UX Designer', location: 'Cape Town, South Africa',
      about: 'Smith is a passionate product designer with over 5 years of experience building intuitive interfaces for fintech and edtech startups.',
      skills: ['Figma', 'User Research', 'Prototyping', 'Design Systems'],
      experience: [
        { role: 'Senior UX Designer', company: 'Yoco', dates: '2022 – Present' },
        { role: 'Product Designer', company: 'Luno', dates: '2019 – 2022' }
      ],
      reviews: [
        { name: 'Patience K.', rating: 5, comment: 'Super clear feedback on my portfolio, really helped.' },
        { name: 'Ariana S.', rating: 5, comment: 'Explained design systems in a way that finally clicked for me.' },
        { name: 'Amanda N.', rating: 4, comment: 'Great session, ran a little over time but worth it.' }
      ]
    },
    {
      id: 'tmokoena', name: 'Thabo Mokoena', role: 'Software Developer', location: 'Johannesburg, South Africa',
      about: 'Thabo is a backend-leaning full-stack developer specialising in Java/Spring Boot and cloud deployment, mentoring students preparing for technical interviews.',
      skills: ['Java', 'Spring Boot', 'SQL', 'AWS'],
      experience: [
        { role: 'Backend Engineer', company: 'Discovery', dates: '2021 – Present' },
        { role: 'Junior Developer', company: 'BBD', dates: '2018 – 2021' }
      ],
      reviews: [
        { name: 'Lerato P.', rating: 5, comment: 'Mock interview was tough but exactly what I needed.' },
        { name: 'Kyle V.', rating: 5, comment: 'Broke down Spring Boot concepts really well.' }
      ]
    },
    {
      id: 'Rstock', name: 'Reotshepile Stock', role: 'Data Analyst', location: 'Durban, South Africa',
      about: 'Anisha works in Power BI and SQL for a logistics company and enjoys helping students turn class projects into portfolio-ready case studies.',
      skills: ['Power BI', 'SQL', 'Excel', 'Python'],
      experience: [
        { role: 'Data & Process Analyst', company: 'Transnet', dates: '2020 – Present' }
      ],
      reviews: [
        { name: 'Zaid H.', rating: 5, comment: 'Helped me turn a boring dataset into an actual dashboard story.' },
        { name: 'Palesa T.', rating: 4, comment: 'Good practical tips on SQL performance.' }
      ]
    }
  ];

  /* Real mentors live in the MySQL `mentors` table (created when someone signs up as a
     Mentor). The three above are built-in sample mentors. Saving sends the signed-in
     mentor's own profile to the server. */
  localStorage.removeItem('lp_custom_mentors'); // old browser-only copy, no longer used
  var mentorSaveTimer = null;
  function saveCustomMentors() {
    clearTimeout(mentorSaveTimer);
    mentorSaveTimer = setTimeout(function () {
      var m = (currentUser && currentUser.accountType === 'mentor' && currentUser.mentorId)
        ? mentors.find(function (x) { return x.id === currentUser.mentorId; }) : null;
      if (!m) return;
      LPBackend.saveMyMentor(m).catch(function (err) { showToast('Could not save to the server: ' + (err.message || 'try again')); });
    }, 350);
  }
  function toClientMentor(r) {
    return { id: r.id, name: r.name, role: r.role || '', location: r.location || '', about: r.about || '',
      skills: r.skills || [], experience: r.experience || [], reviews: [], photo: r.photo || null, custom: true,
      contactEmail: r.contactEmail || '', contactPhone: r.contactPhone || '', linkedin: r.linkedin || '' };
  }
  function upsertMentor(cm) {
    var i = mentors.findIndex(function (x) { return x.id === cm.id; });
    if (i > -1) mentors[i] = cm; else mentors.push(cm);
  }
  function refreshMentorsFromServer() {
    return LPBackend.listMentors().then(function (rows) {
      var own = (currentUser && currentUser.mentorId) ? mentors.find(function (x) { return x.id === currentUser.mentorId; }) : null;
      for (var i = mentors.length - 1; i >= 0; i--) if (mentors[i].custom) mentors.splice(i, 1);
      rows.forEach(function (r) { mentors.push(toClientMentor(r)); });
      if (own && !mentors.some(function (x) { return x.id === own.id; })) mentors.push(own); // e.g. a mentor who has not filled in their role yet
      renderHomeMentors();
      if (document.getElementById('screen-mentors').classList.contains('active')) renderMentorsList();
    }).catch(function () {});
  }

  var currentMentorId = mentors[0].id;
  var selectedBookingDay = null;
  var selectedBookingSlot = null;

  /* Renders either a photo (if the mentor/user uploaded one) or their
     initials — used everywhere a mentor or user avatar is shown. */
  function avatarInner(entity) {
    if (entity && entity.photo) return '<img src="' + entity.photo + '" alt="" class="avatar-img">';
    return escapeHtml(initials(entity && entity.name));
  }

  /* Reads an image file, downsizes it on a canvas, and returns a
     compact JPEG data URL — keeps localStorage usage reasonable. */
  function readImageAsDataUrl(file, maxSize, callback) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  var globalToastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('globalToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(globalToastTimer);
    globalToastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------------------------------------------
     Routing
  --------------------------------------------- */
  function navigate(route, opts) {
    opts = opts || {};
    if (screens.indexOf(route) === -1) route = 'home';

    // Every screen except the public ones (home, sign in/up, forgot,
    // about, contact) requires an account.
    if (PUBLIC_ROUTES.indexOf(route) === -1 && !loggedIn && !opts.skipGate) {
      pendingRoute = route;
      route = 'signin';
      showToast('Sign in to use that — it only takes a moment.');
    }
    // Mentor Dashboard is only for mentor accounts
    if (route === 'mentor-dashboard' && loggedIn && (!currentUser || currentUser.accountType !== 'mentor')) {
      route = 'profile';
    }

    if (route === 'admin' && loggedIn && (!currentUser || !currentUser.isAdmin)) route = 'profile';

    screens.forEach(function (s) {
      var el = document.getElementById('screen-' + s);
      if (el) el.classList.toggle('active', s === route);
    });

    document.querySelectorAll('.nav-link').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === route);
    });

    if (!opts.skipHistory) {
      history.pushState({ route: route }, '', '#' + route);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeMobileMenu();
    closeDropdown();

    if (route === 'mentors') renderMentorsList();
    if (route === 'mentor') renderMentorProfile();
    if (route === 'mentor-dashboard') renderMentorDashboard();
    if (route === 'admin') renderAdmin();
    if (route === 'profile') renderUserProfile();
    if (route === 'subscription') renderSubscriptionState();
    if (route === 'payment') renderPaymentPlanSummary();
  }

  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-nav]');
    if (target) {
      e.preventDefault();
      if (target.hasAttribute('data-mentor-id')) currentMentorId = target.getAttribute('data-mentor-id');
      navigate(target.getAttribute('data-nav'));
    }
  });

  window.addEventListener('popstate', function (e) {
    var route = (e.state && e.state.route) || (location.hash ? location.hash.slice(1) : 'home');
    navigate(route, { skipHistory: true });
  });

  /* ---------------------------------------------
     Auth state (simulated, no backend)
  --------------------------------------------- */
  function setLoggedIn(value) {
    loggedIn = value;
    document.getElementById('loggedOutAuth').style.display = value ? 'none' : 'flex';
    document.getElementById('loggedInAuth').style.display = value ? 'block' : 'none';
    document.querySelectorAll('.gated-link').forEach(function (el) { el.classList.toggle('is-locked', !value); });
    var mentorNavItem = document.getElementById('mentorDashboardNavItem');
    if (mentorNavItem) mentorNavItem.style.display = (value && currentUser && currentUser.accountType === 'mentor') ? 'block' : 'none';
    var adminNavItem = document.getElementById('adminNavItem');
    if (adminNavItem) adminNavItem.style.display = (value && currentUser && currentUser.isAdmin) ? 'block' : 'none';
    if (value && currentUser) {
      var abtn = document.getElementById('avatarBtn');
      abtn.innerHTML = currentUser.photo
        ? '<img src="' + currentUser.photo + '" alt="" class="avatar-img">'
        : escapeHtml(initials(currentUser.name || currentUser.username));
    }
  }

  function doLogout() {
    setLoggedIn(false);
    currentUser = null;
    try { LPBackend.signOut(); } catch (e) {}
    localStorage.removeItem('lp_current_user');
    navigate('home');
  }

  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('logoutBtn2').addEventListener('click', doLogout);

  /* ---------------------------------------------
     Delete account — removes the account (and, for
     mentors, their public listing) from this browser
     for good. Used by both the Profile and Mentor
     Dashboard screens' "Danger zone".
  --------------------------------------------- */
  function deleteAccount() {
    if (!currentUser) return;
    var confirmed = window.confirm('This permanently deletes your account, profile' +
      (currentUser.accountType === 'mentor' ? ', your mentor listing,' : '') +
      ' and bookings from this browser. This can\'t be undone. Continue?');
    if (!confirmed) return;

    var users = loadUsers().filter(function (u) { return u.email.toLowerCase() !== currentUser.email.toLowerCase(); });
    saveUsers(users);

    if (currentUser.accountType === 'mentor' && currentUser.mentorId) {
      var idx = mentors.findIndex(function (mm) { return mm.id === currentUser.mentorId; });
      if (idx > -1) mentors.splice(idx, 1);
      saveCustomMentors();
    }

    bookings = [];
    saveBookings();
    localStorage.removeItem('lp_solved_challenges');
    localStorage.removeItem('lp_last_cv_score');
    subscription = { plan: 'free', billing: 'monthly' };
    saveSubscription();

    LPBackend.deleteAccount().catch(function () {}); // removes the account + mentor profile from MySQL
    currentUser = null;
    try { LPBackend.signOut(); } catch (e) {}
    localStorage.removeItem('lp_current_user');
    setLoggedIn(false);
    renderHomeMentors();
    navigate('home', { skipGate: true });
    showToast('Your account has been deleted.');
  }

  /* Avatar dropdown */
  var dropdown = document.getElementById('loggedInAuth');
  var avatarBtn = document.getElementById('avatarBtn');
  avatarBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    avatarBtn.setAttribute('aria-expanded', dropdown.classList.contains('open'));
  });
  function closeDropdown() {
    dropdown.classList.remove('open');
    avatarBtn.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target)) closeDropdown();
  });

  /* Mobile nav menu */
  var topnav = document.getElementById('topnav');
  var menuToggle = document.getElementById('menuToggle');
  menuToggle.addEventListener('click', function () {
    topnav.classList.toggle('mobile-open');
  });
  function closeMobileMenu() { topnav.classList.remove('mobile-open'); }

  /* ---------------------------------------------
     Password visibility toggles
  --------------------------------------------- */
  document.querySelectorAll('.toggle-visibility').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-toggle-for'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'HIDE' : 'SHOW';
    });
  });

  /* ---------------------------------------------
     Sign In — checked by the server (MySQL)
  --------------------------------------------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setFieldError(inputId, message) {
    var errEl = document.getElementById(inputId + 'Error');
    var input = document.getElementById(inputId);
    if (errEl) errEl.textContent = message || '';
    if (input) input.classList.toggle('invalid', !!message);
  }

  /* ---------------------------------------------
     Real auth helpers (server + MySQL)
  --------------------------------------------- */
  var pendingSignup = null; // mentor details held until the email is verified

  function finishAuth(su, pending) {
    var accType = su.role === 'mentor' ? 'mentor' : 'student';
    var local = findUserByEmail(su.email);
    if (!local) {
      var users = loadUsers();
      users.push({ username: su.name, email: su.email, password: '', phone: '', bio: '', accountType: accType, photo: null, mentorId: null });
      saveUsers(users);
      local = {};
    }
    currentUser = { name: su.name, email: su.email, phone: local.phone || '', bio: local.bio || '', linkedin: local.linkedin || '',
      accountType: accType, photo: local.photo || null, mentorId: null, isAdmin: !!su.isAdmin };
    saveCurrentUser();
    setLoggedIn(true);
    LPBackend.getSubscription().then(function (row) {
      if (row && row.plan) { subscription.plan = row.plan; subscription.billing = row.billing || subscription.billing; saveSubscription(); }
    }).catch(function () {});
    function go() {
      navigate(pendingRoute || (accType === 'mentor' ? 'mentor-dashboard' : 'home'));
      pendingRoute = null;
    }
    if (accType === 'mentor') {
      // The mentor profile lives in MySQL: load it (the server creates it if it is missing), then open the dashboard.
      LPBackend.getMyMentor().then(function (mm) {
        var cm = toClientMentor(mm);
        upsertMentor(cm);
        currentUser.mentorId = cm.id;
        saveCurrentUser();
        renderHomeMentors();
      }).catch(function () { showToast('Could not load your mentor profile. Please refresh.'); }).then(go);
    } else {
      go();
    }
    refreshMentorsFromServer();
  }

  var verifyEmailAddr = '';
  function showVerify(email, pending) {
    verifyEmailAddr = email;
    pendingSignup = pending;
    document.getElementById('verifyEmailText').textContent = email;
    document.getElementById('verifyCode').value = '';
    document.getElementById('verifyError').classList.remove('show');
    navigate('verify');
  }

  document.getElementById('verifyForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = document.getElementById('verifyError');
    errEl.classList.remove('show');
    var code = document.getElementById('verifyCode').value.replace(/\D/g, '');
    if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code from your email.'; errEl.classList.add('show'); return; }
    try {
      var su = await LPBackend.verifyEmail({ email: verifyEmailAddr, code: code });
      var p = pendingSignup; pendingSignup = null;
      finishAuth(su, p);
    } catch (err) {
      errEl.textContent = /too many/i.test(err.message) ? 'Too many attempts. Request a new code.' : 'That code is wrong or has expired.';
      errEl.classList.add('show');
    }
  });

  document.getElementById('verifyResend').addEventListener('click', async function (e) {
    e.preventDefault();
    try { await LPBackend.resendCode(verifyEmailAddr); showToast('New code sent — check your inbox.'); }
    catch (err) { showToast(err.message || 'Could not resend the code.'); }
  });

  document.getElementById('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = document.getElementById('signinEmail').value.trim();
    var pw = document.getElementById('signinPassword').value;
    var formErr = document.getElementById('signinError');
    formErr.classList.remove('show');
    setFieldError('signinEmail', '');
    setFieldError('signinPassword', '');

    var ok = true;
    if (!EMAIL_RE.test(email)) { setFieldError('signinEmail', 'Enter a valid email address.'); ok = false; }
    if (!pw) { setFieldError('signinPassword', 'Enter your password.'); ok = false; }
    if (!ok) return;

    try {
      var su = await LPBackend.signIn({ email: email, password: pw });
      finishAuth(su);
    } catch (err) {
      if (err && /email_not_verified/.test(err.message)) {
        try { await LPBackend.resendCode(email); } catch (e2) { /* cooldown: a code was just sent */ }
        showVerify(email, null);
        return;
      }
      var msg = (err && err.message) || '';
      formErr.textContent = /invalid email or password/i.test(msg) || !msg
        ? 'Incorrect email or password.'
        : msg;   // network / configuration problems are shown as they are, not disguised as a wrong password
      formErr.classList.add('show');
    }
  });

  /* ---------------------------------------------
     Sign Up — password strength + local account creation
  --------------------------------------------- */
  function passwordStrength(pw) {
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score; // 0–5
  }

  function renderStrength(pw) {
    var fill = document.getElementById('strengthFill');
    var label = document.getElementById('strengthLabel');
    if (!pw) { fill.style.width = '0%'; fill.style.background = 'transparent'; label.textContent = ''; return; }
    var score = passwordStrength(pw);
    var pct = Math.min(100, (score / 5) * 100);
    var color = '#b3212f', text = 'Weak';
    if (score >= 4) { color = '#147a3d'; text = 'Strong'; }
    else if (score >= 2) { color = '#ea6818'; text = 'Medium'; }
    fill.style.width = pct + '%';
    fill.style.background = color;
    label.textContent = text;
    label.style.color = color;
  }

  document.getElementById('signupPassword').addEventListener('input', function (e) {
    renderStrength(e.target.value);
  });

  /* Student vs Mentor toggle — shows the extra mentor fields and
     updates the helper line under the segmented control. */
  document.querySelectorAll('input[name="signupAccountType"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var isMentor = document.getElementById('accTypeMentor').checked;
      document.getElementById('mentorSignupFields').style.display = isMentor ? 'block' : 'none';
      document.getElementById('accountTypeHint').textContent = isMentor
        ? 'Get your own mentor profile students can find and book'
        : 'Learning and job-hunting on LaunchPad.dev';
    });
  });

  document.getElementById('signupForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var u = document.getElementById('signupUsername').value.trim();
    var em = document.getElementById('signupEmail').value.trim();
    var p1 = document.getElementById('signupPassword').value;
    var p2 = document.getElementById('signupConfirm').value;
    var accType = document.getElementById('accTypeMentor').checked ? 'mentor' : 'student';
    var formErr = document.getElementById('signupError');
    formErr.classList.remove('show');
    ['signupUsername', 'signupEmail', 'signupPassword', 'signupConfirm', 'signupMentorRole', 'signupMentorLocation'].forEach(function (id) { setFieldError(id, ''); });

    var ok = true;
    if (u.length < 3) { setFieldError('signupUsername', 'Username needs at least 3 characters.'); ok = false; }
    if (!EMAIL_RE.test(em)) { setFieldError('signupEmail', 'Enter a valid email address.'); ok = false; }
    if (p1.length < 8) { setFieldError('signupPassword', 'Password needs at least 8 characters.'); ok = false; }
    if (p1 !== p2) { setFieldError('signupConfirm', 'Passwords do not match.'); ok = false; }

    var mentorRole = '', mentorLocation = '';
    if (accType === 'mentor') {
      mentorRole = document.getElementById('signupMentorRole').value.trim();
      mentorLocation = document.getElementById('signupMentorLocation').value.trim();
      if (!mentorRole) { setFieldError('signupMentorRole', 'Tell students your role.'); ok = false; }
      if (!mentorLocation) { setFieldError('signupMentorLocation', 'Add your location.'); ok = false; }
    }
    if (!ok) return;

    try {
      await LPBackend.startSignup({ name: u, email: em, password: p1, role: accType, mentorRole: mentorRole, mentorLocation: mentorLocation });
      showVerify(em, { accType: accType, mentorRole: mentorRole, mentorLocation: mentorLocation });
    } catch (err) {
      formErr.textContent = err.message || 'Could not create your account. Please try again.';
      formErr.classList.add('show');
    }
  });

  /* ---------------------------------------------
     Forgot password — real lookup + reset against local accounts
  --------------------------------------------- */
  var forgotTargetEmail = null;

  function resetForgotUi() {
    forgotTargetEmail = null;
    document.getElementById('forgotEmailField').style.display = 'block';
    document.getElementById('forgotResetFields').style.display = 'none';
    document.getElementById('forgotSubmitBtn').textContent = 'Continue';
    document.getElementById('forgotForm').reset();
  }

  document.getElementById('forgotForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = document.getElementById('forgotError');
    var successEl = document.getElementById('forgotSuccess');
    var btn = document.getElementById('forgotSubmitBtn');
    errEl.classList.remove('show');
    successEl.classList.remove('show');
    function fail(msg) { errEl.textContent = msg; errEl.classList.add('show'); }

    // Step 1: ask the server to email a 6-digit code.
    if (!forgotTargetEmail) {
      var email = document.getElementById('forgotEmail').value.trim();
      if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');
      btn.disabled = true;
      try { await LPBackend.forgotPassword(email); }
      catch (err) { btn.disabled = false; return fail(err.message || 'Could not send the code. Please try again.'); }
      btn.disabled = false;
      forgotTargetEmail = email;
      document.getElementById('forgotEmailField').style.display = 'none';
      document.getElementById('forgotResetFields').style.display = 'block';
      btn.textContent = 'Reset Password';
      successEl.textContent = 'If an account exists for that email, we sent a 6-digit code. Enter it below with your new password.';
      successEl.classList.add('show');
      return;
    }

    // Step 2: code + new password.
    var code = document.getElementById('forgotCode').value.replace(/\D/g, '');
    var newPw = document.getElementById('forgotNewPassword').value;
    var confirmPw = document.getElementById('forgotNewConfirm').value;
    if (code.length !== 6) return fail('Enter the 6-digit code from your email.');
    if (newPw.length < 8) return fail('New password needs at least 8 characters.');
    if (newPw !== confirmPw) return fail('Passwords do not match.');

    btn.disabled = true;
    try { await LPBackend.resetPassword({ email: forgotTargetEmail, code: code, password: newPw }); }
    catch (err) {
      btn.disabled = false;
      if (/too many/i.test(err.message || '')) { resetForgotUi(); }   // start again to get a fresh code
      return fail(err.message || 'That code is wrong or has expired.');
    }
    btn.disabled = false;
    successEl.textContent = 'Password reset! Redirecting to Sign In…';
    successEl.classList.add('show');
    setTimeout(function () {
      resetForgotUi();
      successEl.classList.remove('show');
      navigate('signin');
    }, 1400);
  });

  /* ---------------------------------------------
     Home search — matches mentors first, then site sections
     (CV Builder, Interview Arena, Pricing...), and always lands
     the person somewhere relevant instead of just the homepage.
  --------------------------------------------- */
  var SEARCH_ROUTES = [
    { keys: ['cv', 'resume', 'résumé', 'cv builder'], route: 'cv-builder' },
    { keys: ['interview', 'challenge', 'coding', 'arena', 'practice'], route: 'interview' },
    { keys: ['pricing', 'plan', 'plans', 'subscription', 'upgrade', 'pro'], route: 'subscription' },
    { keys: ['payment', 'billing', 'card'], route: 'payment' },
    { keys: ['profile', 'account', 'my details'], route: 'profile' },
    { keys: ['mentor', 'mentors', 'coach', 'coaching', 'browse'], route: 'mentors' }
  ];

  document.getElementById('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = e.target.querySelector('input').value.trim();
    var q = raw.toLowerCase();
    if (!q) { navigate('mentors'); return; }

    var mentorMatch = mentors.find(function (m) {
      return m.name.toLowerCase().indexOf(q) > -1 ||
        m.role.toLowerCase().indexOf(q) > -1 ||
        (m.location || '').toLowerCase().indexOf(q) > -1 ||
        m.skills.some(function (s) { return s.toLowerCase().indexOf(q) > -1; });
    });
    if (mentorMatch) {
      currentMentorId = mentorMatch.id;
      navigate('mentor');
      return;
    }

    var routeMatch = SEARCH_ROUTES.find(function (r) {
      return r.keys.some(function (k) { return q.indexOf(k) > -1 || k.indexOf(q) > -1; });
    });
    if (routeMatch) { navigate(routeMatch.route); return; }

    navigate('mentors');
    showToast('No exact match for "' + raw + '" — here are our mentors');
  });

  /* ---------------------------------------------
     Shared HTML-escaping helper (used by Interview Arena, Mentor,
     Profile, and Payment rendering below)
  --------------------------------------------- */
  function escapeHtml(str) { return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------------------------------------------
     CV Builder (LaunchPad LPCV module)
  --------------------------------------------- */
  var LPCV = (function () {

    /* -----------------------------------------------------------------------
       Config / constants
    ----------------------------------------------------------------------- */
    var ALLOWED = ['pdf', 'doc', 'docx'];
    var MAX_BYTES = 5 * 1024 * 1024;

    var ANALYSE_MSGS = [
      'Reading CV...',
      'Extracting information...',
      'Checking ATS compatibility...',
      'Analysing formatting...',
      'Evaluating skills...',
      'Calculating score...'
    ];
    var BUILD_MSGS = [
      'Generating professional summary...',
      'Formatting your details...',
      'Building experience section...',
      'Building education section...',
      'Finalising layout...',
      'Building final document...'
    ];

    // Section headings we look for to decide "is this actually a CV" AND to
    // drive the section-breakdown / recommendations. Same source of truth for both.
    var SECTION_PATTERNS = {
      summary: /(professional\s+summary|career\s+objective|personal\s+statement|profile\s*summary|about\s*me|^summary$)/im,
      education: /(education(?:\s+and\s+training)?|academic\s+background|qualifications?)/i,
      experience: /(work\s+experience|professional\s+experience|employment\s+history|career\s+history|work\s+history|^experience$)/im,
      skills: /(technical\s+skills|core\s+competenc|key\s+skills|^skills$)/im,
      projects: /(projects?|portfolio)/i,
      certifications: /(certifications?|certificates?|licen[cs]es?)/i,
      references: /(references?|referees?)/i
    };

    var EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    var PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?0\)?)?[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}/;
    var LINKEDIN_RE = /linkedin\.com\/[^\s,)]+/i;
    var GITHUB_RE = /github\.com\/[^\s,)]+/i;
    var QUANT_RE = /\d+%|\bR\s?\d|\$\s?\d|\bincreased\b|\breduced\b|\bimproved\b|\bgrew\b|\bsaved\b/i;

    var MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
    var DATE_RANGE = new RegExp(
      '((?:' + MONTH + '\\.?\\s*)?(?:19|20)\\d{2})\\s*(?:-|\u2013|\u2014|to|until)\\s*((?:' + MONTH +
      '\\.?\\s*)?(?:19|20)\\d{2}|present|current|now|ongoing|to\\s*date)', 'i');

    var SKILL_DICT = ['javascript','typescript','react','react native','next.js','vue','angular','svelte','node','node.js','express','nestjs','html','html5','css','css3','sass','scss','tailwind','bootstrap','jquery','python','django','flask','fastapi','java','spring','spring boot','kotlin','swift','objective-c','c','c++','c#','.net','asp.net','php','laravel','symfony','ruby','rails','go','golang','rust','scala','perl','r','matlab','sql','mysql','postgresql','postgres','sqlite','mongodb','firebase','supabase','redis','oracle','ms sql','mssql','dynamodb','cassandra','elasticsearch','graphql','rest','rest api','soap','api','git','github','gitlab','bitbucket','docker','kubernetes','jenkins','ci/cd','terraform','ansible','aws','azure','gcp','google cloud','heroku','netlify','vercel','linux','ubuntu','bash','powershell','windows server','nginx','apache','jira','confluence','trello','asana','slack','figma','adobe xd','photoshop','illustrator','canva','sketch','excel','microsoft excel','word','powerpoint','microsoft office','power bi','tableau','looker','sap','salesforce','pandas','numpy','scikit-learn','tensorflow','pytorch','keras','opencv','machine learning','deep learning','data analysis','data science','etl','hadoop','spark','kafka','airflow','selenium','cypress','jest','mocha','pytest','junit','postman','unit testing','tdd','agile','scrum','kanban','devops','microservices','oop','data structures','algorithms','wordpress','shopify','seo','ux','ui','responsive design','accessibility','webpack','vite','babel','redux','zustand','sockets','websockets','oauth','jwt'];
    var SOFT_DICT = ['communication','teamwork','team work','leadership','problem solving','problem-solving','critical thinking','time management','adaptability','flexibility','creativity','collaboration','attention to detail','work ethic','self-motivated','self motivated','organisation','organization','interpersonal skills','conflict resolution','decision making','negotiation','presentation skills','customer service','mentoring','coaching','emotional intelligence','analytical thinking','initiative','reliability','multitasking','stress management','public speaking','active listening','strategic thinking','project management'];

    var el = {};
    var state = {
      file: null,
      text: '',
      detection: null,
      parsed: null,
      analysed: false,
      score: 0,
      ats: 0,
      timers: []
    };
    var formState = { currentStep: 1 };

    function $(id) { return document.getElementById(id); }

    function cacheDom() {
      [
        // top-level flow
        'lpcvSteps', 'lpcvProgressBar', 'cvFileInput', 'cvFileLabel', 'lpcvDropzone', 'lpcvFileInfo',
        'lpcvFileExt', 'lpcvFileName', 'lpcvFileSize', 'lpcvFileStatus', 'lpcvRemoveFile', 'lpcvFileError',
        'analyseBtn', 'lpcvAnalysing', 'lpcvAnalyseMsg', 'lpcvAnalyseBar', 'lpcvReport', 'lpcvScoreRing',
        'lpcvScoreNum', 'lpcvScoreVerdict', 'lpcvAts', 'lpcvFormatting', 'lpcvReadability', 'lpcvSections',
        'lpcvRecs', 'lpcvGenerateBtn', 'lpcvBuilding', 'lpcvBuildMsg', 'lpcvBuildBar', 'lpcvImproved',
        'lpcvImprovedGain', 'lpcvPreview', 'lpcvDownloadBtn', 'lpcvToast',
        // details form
        'lpcvForm', 'lpcvFormSteps', 'lpcvFormError', 'lpcvFormBack', 'lpcvFormNext', 'lpcvBuildCvBtn',
        'cvFullName', 'cvTitle', 'cvEmail', 'cvPhone', 'cvAddress', 'cvLinkedIn', 'cvGitHub', 'cvPortfolio',
        'cvSummary', 'cvTechSkills', 'cvSoftSkills',
        'cvExperienceList', 'cvAddExperience',
        'cvEducationList', 'cvAddEducation',
        'cvProjectList', 'cvAddProject',
        'cvCertList', 'cvAddCert',
        'cvRefList', 'cvAddRef'
      ].forEach(function (id) { el[id] = $(id); });

      el.lpcvFormStepBtns = el.lpcvForm ? el.lpcvForm.querySelectorAll('.lpcv-fstep') : [];
      el.lpcvFormPanels = el.lpcvForm ? el.lpcvForm.querySelectorAll('.lpcv-fpanel') : [];
    }

    /* -----------------------------------------------------------------------
       Small helpers
    ----------------------------------------------------------------------- */
    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function extOf(name) {
      var parts = String(name).toLowerCase().split('.');
      return parts.length > 1 ? parts.pop() : '';
    }

    function toast(message) {
      if (!el.lpcvToast) return;
      el.lpcvToast.textContent = message;
      el.lpcvToast.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.lpcvToast.classList.remove('show'); }, 3200);
    }

    function show(node, visible) { if (node) node.hidden = !visible; }

    function escapeHtml(str) {
      return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function setStep(step) {
      var items = el.lpcvSteps ? el.lpcvSteps.querySelectorAll('.lpcv-step') : [];
      Array.prototype.forEach.call(items, function (item) {
        var n = Number(item.getAttribute('data-step'));
        item.classList.toggle('is-active', n === step);
        item.classList.toggle('is-done', n < step);
      });
      if (el.lpcvProgressBar) el.lpcvProgressBar.style.width = (step / 4) * 100 + '%';
    }

    function clearTimers() {
      state.timers.forEach(clearInterval);
      state.timers.forEach(clearTimeout);
      state.timers = [];
    }

    function runSequence(msgNode, barNode, messages, duration, done) {
      var start = Date.now();
      var index = 0;
      msgNode.textContent = messages[0];
      barNode.style.width = '4%';

      var msgTimer = setInterval(function () {
        index = (index + 1) % messages.length;
        msgNode.textContent = messages[index];
      }, Math.max(450, duration / messages.length));

      var barTimer = setInterval(function () {
        var pct = Math.min(98, ((Date.now() - start) / duration) * 100);
        barNode.style.width = pct.toFixed(1) + '%';
      }, 60);

      var endTimer = setTimeout(function () {
        clearInterval(msgTimer);
        clearInterval(barTimer);
        barNode.style.width = '100%';
        done();
      }, duration);

      state.timers.push(msgTimer, barTimer, endTimer);
    }

    function animateNumber(node, target, duration) {
      var start = Date.now();
      var timer = setInterval(function () {
        var t = Math.min(1, (Date.now() - start) / duration);
        node.textContent = Math.round(target * t);
        if (t === 1) clearInterval(timer);
      }, 24);
      state.timers.push(timer);
    }

    /* -----------------------------------------------------------------------
       STEP 1 — Upload, extract, validate it's actually a CV
    ----------------------------------------------------------------------- */
    function resetResults() {
      clearTimers();
      state.analysed = false;
      show(el.lpcvAnalysing, false);
      show(el.lpcvReport, false);
      show(el.lpcvForm, false);
      show(el.lpcvBuilding, false);
      show(el.lpcvImproved, false);
      clearFormFields();
    }

    // validateFile(): extension + size only. Content validation happens separately (detectCV).
    function validateFile(file) {
      var ext = extOf(file.name);
      if (ALLOWED.indexOf(ext) === -1) {
        return { valid: false, message: 'Unsupported file type. Please upload a PDF, DOC or DOCX file.' };
      }
      if (file.size > MAX_BYTES) {
        return { valid: false, message: 'File is too large. Maximum size is 5MB.' };
      }
      return { valid: true, ext: ext };
    }

    function readArrayBuffer(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Could not read file')); };
        reader.readAsArrayBuffer(file);
      });
    }

    var pdfWorkerConfigured = false;

    // extractText(): pulls raw text out of PDF or DOCX using the libraries already
    // loaded in index.html. Legacy binary .doc cannot be parsed client-side reliably,
    // so it returns an empty string and is handled as a special case by the caller.
    async function extractText(file) {
      var ext = extOf(file.name);
      var buf = await readArrayBuffer(file);

      if (ext === 'pdf') {
        if (!window.pdfjsLib) return '';
        if (!pdfWorkerConfigured && window.pdfjsLib.GlobalWorkerOptions) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          pdfWorkerConfigured = true;
        }
        var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        var pages = [];
        for (var p = 1; p <= pdf.numPages; p++) {
          var page = await pdf.getPage(p);
          var content = await page.getTextContent();
          var line = '', lastY = null, lineParts = [];
          content.items.forEach(function (item) {
            var y = item.transform[5];
            if (lastY !== null && Math.abs(y - lastY) > 2) { lineParts.push(line); line = ''; }
            line += item.str + ' ';
            lastY = y;
          });
          lineParts.push(line);
          pages.push(lineParts.join('\n'));
        }
        return pages.join('\n');
      }

      if (ext === 'docx') {
        if (!window.mammoth) return '';
        var result = await window.mammoth.extractRawText({ arrayBuffer: buf });
        return result.value || '';
      }

      // legacy .doc — not reliably parseable in-browser
      return '';
    }

    // detectCV(): decides whether the extracted text actually looks like a CV,
    // by checking for common CV section headings plus contact-info patterns.
    function detectCV(text) {
      var lower = (text || '').toLowerCase();
      var matchedSections = [];
      Object.keys(SECTION_PATTERNS).forEach(function (key) {
        if (SECTION_PATTERNS[key].test(lower)) matchedSections.push(key);
      });

      var hasEmail = EMAIL_RE.test(text || '');
      var hasPhone = PHONE_RE.test(text || '');
      var hasLinkedIn = LINKEDIN_RE.test(lower);
      var hasGitHub = GITHUB_RE.test(lower);
      var hasContact = hasEmail || hasPhone || hasLinkedIn || hasGitHub;

      var longEnough = (text || '').trim().length >= 80;
      var isCV = longEnough && (matchedSections.length >= 2 || (matchedSections.length >= 1 && hasContact));

      return {
        isCV: isCV,
        matchedSections: matchedSections,
        hasEmail: hasEmail,
        hasPhone: hasPhone,
        hasLinkedIn: hasLinkedIn,
        hasGitHub: hasGitHub
      };
    }

    function showFileCard(file, ext) {
      el.lpcvFileExt.textContent = ext.toUpperCase();
      el.lpcvFileName.textContent = file.name;
      show(el.lpcvFileInfo, true);
    }

    function rejectFile(message) {
      state.file = null;
      state.text = '';
      state.detection = null;
      state.parsed = null;
      el.cvFileInput.value = '';
      el.cvFileLabel.textContent = 'Tap to browse or drop your CV here';
      show(el.lpcvFileInfo, false);
      el.lpcvFileError.textContent = message;
      show(el.lpcvFileError, true);
      el.analyseBtn.disabled = true;
      resetResults();
      setStep(1);
      toast(message.replace(/^[^A-Za-z0-9]+/, ''));
    }

    function removeFile() {
      state.file = null;
      state.text = '';
      state.detection = null;
      state.parsed = null;
      el.cvFileInput.value = '';
      el.cvFileLabel.textContent = 'Tap to browse or drop your CV here';
      show(el.lpcvFileInfo, false);
      show(el.lpcvFileError, false);
      el.analyseBtn.disabled = true;
      resetResults();
      setStep(1);
    }

    // acceptFile(): the main entry point when a file is chosen/dropped.
    // 1) validates extension/size, 2) extracts text, 3) runs detectCV(),
    // 4) only proceeds to the analysable state if the document is a CV.
    async function acceptFile(file) {
      var validation = validateFile(file);
      if (!validation.valid) { rejectFile(validation.message); return; }
      var ext = validation.ext;

      state.file = file;
      show(el.lpcvFileError, false);
      showFileCard(file, ext);
      el.lpcvFileSize.textContent = formatBytes(file.size) + ' \u00b7 validating\u2026';
      el.lpcvFileStatus.textContent = 'Checking document\u2026';
      el.cvFileLabel.textContent = 'Validating\u2026';
      el.analyseBtn.disabled = true;
      resetResults();
      setStep(1);

      var text = '';
      try {
        text = await extractText(file);
      } catch (err) {
        rejectFile('\u274c Could not read this file. Please try a different PDF or DOCX.');
        return;
      }

      // Legacy .doc binary files can't be parsed client-side — allow through
      // but skip strict verification, and leave the details form fields blank.
      if (ext === 'doc' && text.trim().length < 30) {
        state.text = '';
        state.detection = { isCV: true, matchedSections: [], hasEmail: false, hasPhone: false, hasLinkedIn: false, hasGitHub: false };
        state.parsed = emptyParsed();
        finishAccept(file);
        toast('\u26a0 Could not automatically verify .doc content \u2014 proceeding anyway.');
        return;
      }

      var detection = detectCV(text);
      if (!detection.isCV) {
        rejectFile('\u274c This document does not appear to be a Curriculum Vitae. Please upload a valid CV.');
        return;
      }

      state.text = text;
      state.detection = detection;
      state.parsed = parseCV(text);
      finishAccept(file);
    }

    function finishAccept(file) {
      el.cvFileLabel.textContent = 'Choose a different file';
      el.lpcvFileStatus.textContent = '\u2705 CV detected successfully';
      el.lpcvFileSize.textContent = formatBytes(file.size) + ' \u00b7 uploaded just now';
      el.analyseBtn.disabled = false;
      setStep(2);
      toast('\u2705 CV detected successfully');
    }

    /* -----------------------------------------------------------------------
       STEP 2 + 3 — Analysis + report (now driven by real detected content)
    ----------------------------------------------------------------------- */
    function computeScore() {
      var det = state.detection || {};
      var matched = det.matchedSections || [];
      var coreSections = ['summary', 'education', 'experience', 'skills', 'projects', 'certifications'];
      var have = coreSections.filter(function (s) { return matched.indexOf(s) > -1; }).length;

      var base = 52 + Math.round((have / coreSections.length) * 30); // 52-82
      var contactBonus = (det.hasEmail ? 3 : 0) + (det.hasPhone ? 3 : 0) + (det.hasLinkedIn ? 4 : 0) + (det.hasGitHub ? 5 : 0);
      var quantBonus = QUANT_RE.test(state.text || '') ? 5 : 0;

      var score = Math.max(45, Math.min(96, base + contactBonus + quantBonus));
      var ats = Math.max(50, Math.min(98, score + (det.hasLinkedIn || det.hasGitHub ? 6 : 2)));
      return { score: score, ats: ats };
    }

    function verdictClass(verdict) {
      if (verdict === 'Strong' || verdict === 'Excellent') return 'is-strong';
      if (verdict === 'Good') return 'is-good';
      return 'is-weak';
    }

    function buildSectionBreakdown() {
      var det = state.detection || {};
      var matched = det.matchedSections || [];
      var map = [
        { key: 'summary', name: 'Professional Summary' },
        { key: 'skills', name: 'Skills' },
        { key: 'experience', name: 'Experience' },
        { key: 'education', name: 'Education' },
        { key: 'projects', name: 'Projects' },
        { key: 'contact', name: 'Contact & Links' }
      ];
      return map.map(function (s) {
        var present = s.key === 'contact' ? (det.hasEmail || det.hasPhone) : matched.indexOf(s.key) > -1;
        var scoreVal = present ? 74 + (s.name.length % 20) : 28 + (s.name.length % 12);
        scoreVal = Math.min(97, scoreVal);
        var verdict = !present ? 'Missing' : (scoreVal >= 90 ? 'Excellent' : scoreVal >= 80 ? 'Strong' : scoreVal >= 65 ? 'Good' : 'Needs Improvement');
        return { name: s.name, verdict: verdict, score: scoreVal };
      });
    }

    // buildRecommendations(): dynamic, based on what detectCV() actually found.
    function buildRecommendations() {
      var det = state.detection || {};
      var matched = det.matchedSections || [];
      var recs = [];
      function add(missing, title, note, priority) {
        if (missing) recs.push({ title: title, note: note, priority: priority });
      }

      add(!det.hasGitHub, 'Add your GitHub profile', 'Recruiters check code before calling \u2014 add a GitHub link.', 'high');
      add(matched.indexOf('summary') === -1, 'Add a Professional Summary', 'Three lines: who you are, your proof, what you want next.', 'high');
      add(matched.indexOf('skills') === -1, 'Add a Skills section', 'List your technical and soft skills clearly.', 'high');
      add(matched.indexOf('experience') === -1, 'Add a Work Experience section', 'List your roles with dates and responsibilities.', 'high');
      add(matched.indexOf('projects') === -1, 'Add a Projects section', 'List at least 2 projects with stack, role and outcome.', 'medium');
      add(!det.hasLinkedIn, 'Add your LinkedIn profile', 'Include a clean linkedin.com/in/ URL in your header.', 'medium');
      add(matched.indexOf('certifications') === -1, 'Add Certifications', 'Include relevant certifications or completed courses.', 'medium');
      add(matched.indexOf('references') === -1, 'Add References', 'Add references, or note "available on request".', 'low');
      add(!QUANT_RE.test(state.text || ''), 'Add measurable achievements', 'Quantify results, e.g. "reduced load time by 42%".', 'medium');

      if (!recs.length) {
        recs.push({ title: 'Great coverage', note: 'Your CV already includes the core sections recruiters look for.', priority: 'low' });
      }

      var order = { high: 0, medium: 1, low: 2 };
      return recs.sort(function (a, b) { return order[a.priority] - order[b.priority]; });
    }

    // generateAnalysis(): runs the (cosmetic) analysis animation, then renders
    // a report built entirely from computeScore() / buildSectionBreakdown() / buildRecommendations().
    function generateAnalysis() {
      if (!state.file) { toast('Please upload your CV first.'); return; }

      resetResults();
      setStep(2);
      el.analyseBtn.disabled = true;
      show(el.lpcvAnalysing, true);
      el.lpcvAnalysing.scrollIntoView({ behavior: 'smooth', block: 'center' });

      var duration = 3000 + Math.round(Math.random() * 2000);

      runSequence(el.lpcvAnalyseMsg, el.lpcvAnalyseBar, ANALYSE_MSGS, duration, function () {
        show(el.lpcvAnalysing, false);
        renderReport();
        el.analyseBtn.disabled = false;
        state.analysed = true;
        setStep(3);
        show(el.lpcvReport, true);
        el.lpcvReport.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('\u2713 Analysis complete \u2014 score ' + state.score + '/100');
      });
    }

    function renderReport() {
      var sc = computeScore();
      state.score = sc.score;
      state.ats = sc.ats;

      el.lpcvScoreVerdict.textContent = state.score >= 85
        ? 'Strong CV. A few refinements will make it recruiter-ready.'
        : 'Solid foundation. Fix the high-priority items below to raise your score.';

      el.lpcvAts.textContent = state.ats + '%';
      el.lpcvFormatting.textContent = /\n\s*[-\u2022*]/.test(state.text || '') ? 'Good' : 'Needs bullet points';
      el.lpcvReadability.textContent = (state.text || '').length > 500 ? 'Good' : 'Thin content';

      animateNumber(el.lpcvScoreNum, state.score, 1100);
      el.lpcvScoreRing.style.setProperty('--lpcv-score', 0);
      state.timers.push(setTimeout(function () {
        el.lpcvScoreRing.style.setProperty('--lpcv-score', state.score);
      }, 80));

      var sections = buildSectionBreakdown();
      el.lpcvSections.innerHTML = sections.map(function (section) {
        return '<div class="lpcv-sec ' + verdictClass(section.verdict) + '">' +
          '<div class="lpcv-sec-top"><span class="lpcv-sec-name">' + escapeHtml(section.name) + '</span>' +
          '<span class="lpcv-sec-verdict">' + escapeHtml(section.verdict) + '</span></div>' +
          '<div class="lpcv-sec-track"><div class="lpcv-sec-fill" data-fill="' + section.score + '"></div></div>' +
          '</div>';
      }).join('');

      state.timers.push(setTimeout(function () {
        Array.prototype.forEach.call(el.lpcvSections.querySelectorAll('.lpcv-sec-fill'), function (fill) {
          fill.style.width = fill.getAttribute('data-fill') + '%';
        });
      }, 120));

      var label = { high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority' };
      el.lpcvRecs.innerHTML = buildRecommendations().map(function (rec) {
        return '<li class="lpcv-rec">' +
          '<div class="lpcv-rec-body"><div class="lpcv-rec-title">' + escapeHtml(rec.title) + '</div>' +
          '<div class="lpcv-rec-note">' + escapeHtml(rec.note) + '</div></div>' +
          '<span class="lpcv-badge ' + rec.priority + '">' + label[rec.priority] + '</span>' +
          '</li>';
      }).join('');
    }

    /* -----------------------------------------------------------------------
       Rule-based CV text parser (feeds the prefill form)
    ----------------------------------------------------------------------- */
    var HEADINGS = {
      summary: /^(professional\s+summary|summary|profile|about\s*me|career\s+objective|objective|personal\s+statement)\s*:?\s*$/i,
      skills: /^(technical\s+skills|skills|core\s+competenc(?:ies|es)|technologies|tech\s+stack|technical\s+expertise)\s*:?\s*$/i,
      soft: /^(soft\s+skills|interpersonal\s+skills|personal\s+skills|key\s+strengths)\s*:?\s*$/i,
      experience: /^(work\s+experience|professional\s+experience|employment(?:\s+history)?|experience|career\s+history|work\s+history)\s*:?\s*$/i,
      education: /^(education(?:\s+and\s+training)?|academic\s+background|qualifications?|academic\s+qualifications?)\s*:?\s*$/i,
      projects: /^(projects?|personal\s+projects?|key\s+projects?|portfolio)\s*:?\s*$/i,
      certifications: /^(certifications?|certificates?|licen[cs]es?|courses?|training)\s*:?\s*$/i,
      references: /^(references?|referees?)\s*:?\s*$/i
    };

    function clean(s) {
      return (s || '').replace(/\u00a0/g, ' ').replace(/[\u2022\u00b7\u25aa\u25e6]/g, '').replace(/\s+/g, ' ').trim();
    }

    function toLines(text) {
      return text.replace(/\r/g, '').split('\n').map(clean).filter(function (l) { return l.length > 0; });
    }

    function sectionise(lines) {
      var map = {}, current = '_head';
      map[current] = [];
      lines.forEach(function (l) {
        var hit = null;
        Object.keys(HEADINGS).forEach(function (k) {
          if (!hit && HEADINGS[k].test(l.replace(/[:\-\u2013\u2014]+$/, '').trim())) hit = k;
        });
        if (hit) { current = hit; if (!map[current]) map[current] = []; return; }
        if (!map[current]) map[current] = [];
        map[current].push(l);
      });
      return map;
    }

    function firstMatch(text, re) { var m = text.match(re); return m ? m[0] : ''; }

    function parsePersonal(text, sec) {
      var email = firstMatch(text, EMAIL_RE);
      var phone = firstMatch(text, PHONE_RE);
      var linkedin = firstMatch(text, /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,|)]+/i);
      var github = firstMatch(text, /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s,|)]+/i);
      var site = '';
      var urls = text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|net|io|dev|co|co\.za|org|me|app|tech|xyz)(?:\/[^\s,|)]*)?/gi) || [];
      for (var i = 0; i < urls.length; i++) {
        var u = urls[i];
        if (/linkedin|github|gmail|yahoo|outlook|hotmail|icloud/i.test(u)) continue;
        if (email && email.indexOf(u.replace(/^https?:\/\//, '')) > -1) continue;
        site = u; break;
      }

      var head = (sec._head || []).slice(0, 12);
      var name = '', title = '';
      for (var j = 0; j < head.length; j++) {
        var l = head[j];
        if (/@|https?:|linkedin|github|\d{5,}/i.test(l)) continue;
        var words = l.split(' ').filter(Boolean);
        if (words.length >= 2 && words.length <= 5 && /^[A-Za-z'\u2019.\- ]+$/.test(l) && l.length <= 45) {
          var caps = words.filter(function (w) { return /^[A-Z]/.test(w) || w === w.toUpperCase(); }).length;
          if (caps >= 2) {
            name = l.replace(/\b([A-Z])([A-Z]+)\b/g, function (_, a, b) { return a + b.toLowerCase(); });
            for (var k = j + 1; k < head.length; k++) {
              var t = head[k];
              if (/@|https?:|linkedin|github|\d{5,}/i.test(t)) continue;
              if (t.length > 2 && t.length <= 70) { title = t; break; }
            }
            break;
          }
        }
      }

      var address = '';
      for (var a = 0; a < head.length; a++) {
        if (/\b(street|str\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|suburb|city|province|south africa|gauteng|western cape|kwazulu|pretoria|johannesburg|cape town|durban|\d{4}\b)/i.test(head[a])
          && !/@|linkedin|github/i.test(head[a])) { address = head[a]; break; }
      }

      return { fullName: name, title: title, email: email, phone: clean(phone), address: address, linkedin: linkedin, github: github, website: site };
    }

    function parseList(arr, dict) {
      var joined = arr.join(' , ').toLowerCase();
      var found = [];
      dict.forEach(function (s) {
        var re = new RegExp('(^|[^a-z0-9+#.])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9+#.]|$)', 'i');
        if (re.test(joined)) found.push(s);
      });
      arr.forEach(function (l) {
        l.split(/[,;|\u2022\/]/).forEach(function (p) {
          p = clean(p);
          if (p.length > 1 && p.length < 40 && !/^\d+$/.test(p)) found.push(p);
        });
      });
      var seen = {}, out = [];
      found.forEach(function (f) {
        var key = f.toLowerCase();
        if (!seen[key]) { seen[key] = 1; out.push(f); }
      });
      return out.slice(0, 40);
    }

    function parseExperience(arr) {
      var jobs = [], cur = null;
      arr.forEach(function (l) {
        var dm = l.match(DATE_RANGE);
        var bullet = /^(?:[-\u2013\u2014*\u2022]|\d+[.)])\s+/.test(l);
        if (dm && !bullet) {
          if (cur) jobs.push(cur);
          var rest = clean(l.replace(dm[0], '').replace(/[|,\-\u2013\u2014]+\s*$/, '').replace(/^\s*[|,\-\u2013\u2014]+/, ''));
          var parts = rest.split(/\s+(?:at|@|[-\u2013\u2014|,])\s+/i).map(clean).filter(Boolean);
          cur = { position: parts[0] || '', company: parts[1] || '', startDate: clean(dm[1]), endDate: clean(dm[2]), responsibilities: [] };
          return;
        }
        if (!cur) { if (l.length > 2) cur = { position: l, company: '', startDate: '', endDate: '', responsibilities: [] }; return; }
        if (bullet) { cur.responsibilities.push(clean(l.replace(/^(?:[-\u2013\u2014*\u2022]|\d+[.)])\s+/, ''))); return; }
        if (!cur.company && l.length < 60) { cur.company = l; return; }
        cur.responsibilities.push(l);
      });
      if (cur) jobs.push(cur);
      return jobs.filter(function (j) { return j.position || j.company; }).slice(0, 12);
    }

    function parseEducation(arr) {
      var out = [], cur = null;
      arr.forEach(function (l) {
        var range = l.match(DATE_RANGE);
        var year = l.match(/(19|20)\d{2}/);
        var isInst = /(university|college|tvet|institute|school|academy|campus|unisa|wits|uct|ukzn|tut|cput|dut|vut|nwu|up\b)/i.test(l);
        var isQual = /(bachelor|b\.?sc|b\.?com|b\.?a\b|b\.?tech|honours|honors|master|m\.?sc|mba|phd|doctorate|diploma|higher certificate|national certificate|certificate|nqf|matric|national senior certificate|grade\s*12|associate|degree)/i.test(l);

        if (!cur) cur = { institution: '', qualification: '', startYear: '', endYear: '' };
        if (isQual && !cur.qualification) cur.qualification = clean(l.replace(DATE_RANGE, ''));
        else if (isInst && !cur.institution) cur.institution = clean(l.replace(DATE_RANGE, ''));
        else if (!cur.qualification) cur.qualification = clean(l.replace(DATE_RANGE, ''));
        else if (!cur.institution) cur.institution = clean(l.replace(DATE_RANGE, ''));

        if (range) {
          cur.startYear = (range[1].match(/(19|20)\d{2}/) || [''])[0];
          cur.endYear = /present|current|now|ongoing|date/i.test(range[2]) ? 'Present' : (range[2].match(/(19|20)\d{2}/) || [''])[0];
        } else if (year && !cur.endYear) cur.endYear = year[0];

        if (cur.institution && cur.qualification) { out.push(cur); cur = null; }
      });
      if (cur && (cur.institution || cur.qualification)) out.push(cur);
      return out.slice(0, 8);
    }

    function parseProjects(arr) {
      var out = [], cur = null;
      arr.forEach(function (l) {
        var bullet = /^(?:[-\u2013\u2014*\u2022]|\d+[.)])\s+/.test(l);
        var techLine = l.match(/^(?:tech(?:nologies)?|stack|tools|built with)\s*(?:used)?\s*[:\-]\s*(.+)$/i);
        if (techLine) { if (cur) cur.technologies = clean(techLine[1]); return; }
        if (!bullet && l.length <= 70 && !/[.]$/.test(l)) {
          if (cur) out.push(cur);
          cur = { name: clean(l.replace(/[:\-\u2013\u2014]+$/, '')), description: '', technologies: '' };
          return;
        }
        if (!cur) cur = { name: '', description: '', technologies: '' };
        var t = clean(l.replace(/^(?:[-\u2013\u2014*\u2022]|\d+[.)])\s+/, ''));
        cur.description = cur.description ? cur.description + ' ' + t : t;
      });
      if (cur && (cur.name || cur.description)) out.push(cur);
      return out.slice(0, 10);
    }

    function parseSimpleItems(arr) {
      var out = [];
      arr.forEach(function (l) {
        var t = clean(l.replace(/^(?:[-\u2013\u2014*\u2022]|\d+[.)])\s+/, ''));
        if (t.length > 1) out.push(t);
      });
      return out.slice(0, 20);
    }

    function parseReferences(arr) {
      var out = [], cur = null;
      arr.forEach(function (l) {
        if (/available on request|upon request/i.test(l)) { out.push({ name: clean(l), position: '', company: '', email: '', phone: '' }); cur = null; return; }
        var email = firstMatch(l, EMAIL_RE);
        var phone = firstMatch(l, PHONE_RE);
        var isName = /^[A-Z][a-z\u2019'\-]+(?:\s+[A-Z][a-z\u2019'\-]+){1,3}$/.test(l.replace(/^(?:[-\u2013\u2014*\u2022])\s*/, ''));
        if (isName) { if (cur) out.push(cur); cur = { name: clean(l.replace(/^(?:[-\u2013\u2014*\u2022])\s*/, '')), position: '', company: '', email: '', phone: '' }; return; }
        if (!cur) cur = { name: '', position: '', company: '', email: '', phone: '' };
        if (email) cur.email = email;
        if (phone && !email) cur.phone = clean(phone);
        if (!email && !phone) { if (!cur.position) cur.position = l; else if (!cur.company) cur.company = l; }
      });
      if (cur && (cur.name || cur.email || cur.phone)) out.push(cur);
      return out.slice(0, 6);
    }

    function emptyParsed() {
      return {
        personal: { fullName: '', title: '', email: '', phone: '', address: '', linkedin: '', github: '', website: '' },
        summary: '', skills: [], softSkills: [], experience: [], education: [], projects: [], certifications: [], references: []
      };
    }

    function parseCV(text) {
      var ls = toLines(text);
      var sec = sectionise(ls);
      var flat = ls.join('\n');
      return {
        personal: parsePersonal(flat, sec),
        summary: (sec.summary || []).join(' ').slice(0, 1200),
        skills: parseList(sec.skills || [], SKILL_DICT),
        softSkills: parseList(sec.soft || [], SOFT_DICT),
        experience: parseExperience(sec.experience || []),
        education: parseEducation(sec.education || []),
        projects: parseProjects(sec.projects || []),
        certifications: parseSimpleItems(sec.certifications || []),
        references: parseReferences(sec.references || [])
      };
    }

    /* -----------------------------------------------------------------------
       Details form — navigation, repeaters, prefill
    ----------------------------------------------------------------------- */
    function clearFormFields() {
      if (!el.lpcvForm) return;
      ['cvFullName', 'cvTitle', 'cvEmail', 'cvPhone', 'cvAddress', 'cvLinkedIn', 'cvGitHub', 'cvPortfolio',
       'cvSummary', 'cvTechSkills', 'cvSoftSkills'].forEach(function (id) { if (el[id]) el[id].value = ''; });
      [el.cvExperienceList, el.cvEducationList, el.cvProjectList, el.cvCertList, el.cvRefList].forEach(function (list) {
        if (list) list.innerHTML = '';
      });
      show(el.lpcvFormError, false);
      formState.currentStep = 1;
    }

    function setInputValue(node, value) { if (node) node.value = value || ''; }

    function makeItem(innerHtml) {
      var row = document.createElement('div');
      row.className = 'lpcv-item';
      row.innerHTML = innerHtml;
      row.querySelector('.lpcv-item-remove').addEventListener('click', function () { row.remove(); });
      return row;
    }

    function addExperienceRow(data) {
      data = data || {};
      var row = makeItem(
        '<div class="lpcv-item-head"><strong>Experience</strong><button type="button" class="lpcv-item-remove" aria-label="Remove experience">&times;</button></div>' +
        '<div class="lpcv-grid-2">' +
          '<div class="field"><label>Company</label><input type="text" class="f-company" value="' + escapeHtml(data.company) + '" placeholder="e.g. Company (Pty) Ltd"></div>' +
          '<div class="field"><label>Position</label><input type="text" class="f-position" value="' + escapeHtml(data.position) + '" placeholder="e.g. Junior Developer"></div>' +
          '<div class="field"><label>Start Date</label><input type="text" class="f-start" value="' + escapeHtml(data.startDate) + '" placeholder="e.g. Jan 2023"></div>' +
          '<div class="field"><label>End Date</label><input type="text" class="f-end" value="' + escapeHtml(data.endDate) + '" placeholder="e.g. Present"></div>' +
        '</div>' +
        '<div class="field"><label>Responsibilities</label><textarea class="f-resp" rows="3" placeholder="One per line">' + escapeHtml((data.responsibilities || []).join('\n')) + '</textarea></div>'
      );
      el.cvExperienceList.appendChild(row);
    }

    function addEducationRow(data) {
      data = data || {};
      var row = makeItem(
        '<div class="lpcv-item-head"><strong>Qualification</strong><button type="button" class="lpcv-item-remove" aria-label="Remove qualification">&times;</button></div>' +
        '<div class="lpcv-grid-2">' +
          '<div class="field"><label>Institution</label><input type="text" class="f-institution" value="' + escapeHtml(data.institution) + '" placeholder="e.g. University of Cape Town"></div>' +
          '<div class="field"><label>Qualification</label><input type="text" class="f-qualification" value="' + escapeHtml(data.qualification) + '" placeholder="e.g. BSc Computer Science"></div>' +
          '<div class="field"><label>Start Year</label><input type="text" class="f-start-year" value="' + escapeHtml(data.startYear) + '" placeholder="e.g. 2021"></div>' +
          '<div class="field"><label>End Year</label><input type="text" class="f-end-year" value="' + escapeHtml(data.endYear) + '" placeholder="e.g. 2024"></div>' +
        '</div>'
      );
      el.cvEducationList.appendChild(row);
    }

    function addProjectRow(data) {
      data = data || {};
      var row = makeItem(
        '<div class="lpcv-item-head"><strong>Project</strong><button type="button" class="lpcv-item-remove" aria-label="Remove project">&times;</button></div>' +
        '<div class="field"><label>Project Name</label><input type="text" class="f-name" value="' + escapeHtml(data.name) + '" placeholder="e.g. LaunchPad CV Builder"></div>' +
        '<div class="field"><label>Description</label><textarea class="f-description" rows="2" placeholder="What did you build and what was the outcome?">' + escapeHtml(data.description) + '</textarea></div>' +
        '<div class="field"><label>Technologies Used</label><input type="text" class="f-tech" value="' + escapeHtml(data.technologies) + '" placeholder="e.g. React, Node.js, MongoDB"></div>'
      );
      el.cvProjectList.appendChild(row);
    }

    function addCertRow(data) {
      data = data || {};
      var row = makeItem(
        '<div class="lpcv-item-head"><strong>Certification</strong><button type="button" class="lpcv-item-remove" aria-label="Remove certification">&times;</button></div>' +
        '<div class="lpcv-grid-2">' +
          '<div class="field"><label>Certification Name</label><input type="text" class="f-cert-name" value="' + escapeHtml(data.name) + '" placeholder="e.g. AWS Cloud Practitioner"></div>' +
          '<div class="field"><label>Year (optional)</label><input type="text" class="f-cert-year" value="' + escapeHtml(data.year) + '" placeholder="e.g. 2024"></div>' +
        '</div>'
      );
      el.cvCertList.appendChild(row);
    }

    function addReferenceRow(data) {
      data = data || {};
      var row = makeItem(
        '<div class="lpcv-item-head"><strong>Reference</strong><button type="button" class="lpcv-item-remove" aria-label="Remove reference">&times;</button></div>' +
        '<div class="lpcv-grid-2">' +
          '<div class="field"><label>Name</label><input type="text" class="f-ref-name" value="' + escapeHtml(data.name) + '" placeholder="e.g. Jane Dlamini"></div>' +
          '<div class="field"><label>Position</label><input type="text" class="f-ref-position" value="' + escapeHtml(data.position) + '" placeholder="e.g. Engineering Manager"></div>' +
          '<div class="field"><label>Company</label><input type="text" class="f-ref-company" value="' + escapeHtml(data.company) + '" placeholder="e.g. Company (Pty) Ltd"></div>' +
          '<div class="field"><label>Email</label><input type="email" class="f-ref-email" value="' + escapeHtml(data.email) + '" placeholder="jane@company.com"></div>' +
          '<div class="field"><label>Phone</label><input type="tel" class="f-ref-phone" value="' + escapeHtml(data.phone) + '" placeholder="+27 82 000 0000"></div>' +
        '</div>'
      );
      el.cvRefList.appendChild(row);
    }

    // showGenerationForm(): transitions from the report to the details form,
    // and pre-fills every field the parser could confidently extract.
    function showGenerationForm() {
      if (!state.analysed) { toast('Analyse your CV first.'); return; }

      show(el.lpcvReport, false);
      prefillForm(state.parsed || emptyParsed());
      goToFormStep(1);
      show(el.lpcvForm, true);
      el.lpcvForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function prefillForm(data) {
      var p = data.personal || {};
      setInputValue(el.cvFullName, p.fullName);
      setInputValue(el.cvTitle, p.title);
      setInputValue(el.cvEmail, p.email);
      setInputValue(el.cvPhone, p.phone);
      setInputValue(el.cvAddress, p.address);
      setInputValue(el.cvLinkedIn, p.linkedin);
      setInputValue(el.cvGitHub, p.github);
      setInputValue(el.cvPortfolio, p.website);
      setInputValue(el.cvSummary, data.summary);
      setInputValue(el.cvTechSkills, (data.skills || []).join(', '));
      setInputValue(el.cvSoftSkills, (data.softSkills || []).join(', '));

      el.cvExperienceList.innerHTML = '';
      el.cvEducationList.innerHTML = '';
      el.cvProjectList.innerHTML = '';
      el.cvCertList.innerHTML = '';
      el.cvRefList.innerHTML = '';

      (data.experience && data.experience.length ? data.experience : [{}]).forEach(addExperienceRow);
      (data.education && data.education.length ? data.education : [{}]).forEach(addEducationRow);
      (data.projects && data.projects.length ? data.projects : [{}]).forEach(addProjectRow);
      var certRows = (data.certifications || []).map(function (name) { return { name: name, year: '' }; });
      (certRows.length ? certRows : [{}]).forEach(addCertRow);
      // References are optional — only pre-add a row if any were actually found.
      (data.references && data.references.length ? data.references : []).forEach(addReferenceRow);
    }

    function goToFormStep(n) {
      formState.currentStep = n;
      Array.prototype.forEach.call(el.lpcvFormStepBtns, function (b) {
        var s = Number(b.getAttribute('data-fstep'));
        b.classList.toggle('is-active', s === n);
        b.classList.toggle('is-done', s < n);
      });
      Array.prototype.forEach.call(el.lpcvFormPanels, function (panel) {
        panel.classList.toggle('is-active', Number(panel.getAttribute('data-fpanel')) === n);
      });
      show(el.lpcvFormBack, n > 1);
      show(el.lpcvFormNext, n < 4);
      show(el.lpcvBuildCvBtn, n === 4);
    }

    function validateStep1() {
      var name = el.cvFullName.value.trim();
      var title = el.cvTitle.value.trim();
      if (!name || !title) {
        el.lpcvFormError.textContent = 'Please enter your full name and professional title before continuing.';
        show(el.lpcvFormError, true);
        goToFormStep(1);
        return false;
      }
      show(el.lpcvFormError, false);
      return true;
    }

    /* -----------------------------------------------------------------------
       Collecting the form + generating the real CV
    ----------------------------------------------------------------------- */
    function splitList(str) {
      return (str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function rowsFrom(container, fieldMap) {
      return Array.prototype.map.call(container.querySelectorAll('.lpcv-item'), function (row) {
        var obj = {};
        Object.keys(fieldMap).forEach(function (key) {
          var node = row.querySelector(fieldMap[key]);
          obj[key] = node ? node.value.trim() : '';
        });
        return obj;
      }).filter(function (o) { return Object.keys(o).some(function (k) { return o[k]; }); });
    }

    function collectFormData() {
      var experience = rowsFrom(el.cvExperienceList, { company: '.f-company', position: '.f-position', startDate: '.f-start', endDate: '.f-end', responsibilities: '.f-resp' })
        .map(function (e) { return { company: e.company, position: e.position, startDate: e.startDate, endDate: e.endDate, responsibilities: (e.responsibilities || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean) }; });

      var education = rowsFrom(el.cvEducationList, { institution: '.f-institution', qualification: '.f-qualification', startYear: '.f-start-year', endYear: '.f-end-year' });
      var projects = rowsFrom(el.cvProjectList, { name: '.f-name', description: '.f-description', technologies: '.f-tech' });
      var certifications = rowsFrom(el.cvCertList, { name: '.f-cert-name', year: '.f-cert-year' });
      var references = rowsFrom(el.cvRefList, { name: '.f-ref-name', position: '.f-ref-position', company: '.f-ref-company', email: '.f-ref-email', phone: '.f-ref-phone' });

      return {
        personal: {
          fullName: el.cvFullName.value.trim(),
          title: el.cvTitle.value.trim(),
          email: el.cvEmail.value.trim(),
          phone: el.cvPhone.value.trim(),
          address: el.cvAddress.value.trim(),
          linkedin: el.cvLinkedIn.value.trim(),
          github: el.cvGitHub.value.trim(),
          website: el.cvPortfolio.value.trim()
        },
        summary: el.cvSummary.value.trim(),
        skills: splitList(el.cvTechSkills.value),
        softSkills: splitList(el.cvSoftSkills.value),
        experience: experience,
        education: education,
        projects: projects,
        certifications: certifications,
        references: references
      };
    }

    function cvBlock(title, inner) { return '<div class="lpcv-cv-block"><h3>' + escapeHtml(title) + '</h3>' + inner + '</div>'; }
    function tagList(arr) { return '<ul class="lpcv-cv-tags">' + arr.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>'; }

    function experienceEntry(e) {
      return '<div class="lpcv-cv-entry"><div class="lpcv-cv-entry-head"><strong>' + escapeHtml(e.position || '') + (e.company ? ', ' + escapeHtml(e.company) : '') + '</strong>' +
        '<span>' + escapeHtml(e.startDate || '') + ' \u2013 ' + escapeHtml(e.endDate || '') + '</span></div>' +
        (e.responsibilities.length ? '<ul>' + e.responsibilities.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }
    function educationEntry(e) {
      return '<div class="lpcv-cv-entry"><div class="lpcv-cv-entry-head"><strong>' + escapeHtml(e.qualification || '') + '</strong>' +
        '<span>' + escapeHtml(e.startYear || '') + ' \u2013 ' + escapeHtml(e.endYear || '') + '</span></div>' +
        (e.institution ? '<p>' + escapeHtml(e.institution) + '</p>' : '') + '</div>';
    }
    function projectEntry(p) {
      return '<div class="lpcv-cv-entry"><div class="lpcv-cv-entry-head"><strong>' + escapeHtml(p.name || '') + '</strong></div>' +
        (p.description ? '<p>' + escapeHtml(p.description) + '</p>' : '') +
        (p.technologies ? '<p><em>' + escapeHtml(p.technologies) + '</em></p>' : '') + '</div>';
    }
    function referenceEntry(r) {
      return '<div class="lpcv-cv-entry"><div class="lpcv-cv-entry-head"><strong>' + escapeHtml(r.name || '') + '</strong></div>' +
        '<p>' + [r.position, r.company].filter(Boolean).map(escapeHtml).join(', ') + '</p>' +
        '<p>' + [r.email, r.phone].filter(Boolean).map(escapeHtml).join(' \u00b7 ') + '</p>' + '</div>';
    }

    function estimateGain(data) {
      var fields = [data.summary, data.skills.length, data.experience.length, data.education.length, data.projects.length, data.certifications.length];
      var filled = fields.filter(Boolean).length;
      return Math.round((filled / fields.length) * 20);
    }

    // renderFinalCV(): builds the preview using ONLY data the user entered/confirmed in the form.
    function renderFinalCV(data) {
      var p = data.personal;
      var html = '<div class="lpcv-cv-head">' +
        '<h2 class="lpcv-cv-name">' + escapeHtml(p.fullName || '') + '</h2>' +
        (p.title ? '<p class="lpcv-cv-role">' + escapeHtml(p.title) + '</p>' : '') +
        '<p class="lpcv-cv-contact">' + [p.email, p.phone, p.address, p.linkedin, p.github, p.website].filter(Boolean).map(escapeHtml).join(' &nbsp;|&nbsp; ') + '</p>' +
        '</div>';

      if (data.summary) html += cvBlock('Professional Summary', '<p>' + escapeHtml(data.summary) + '</p>');
      if (data.skills.length) html += cvBlock('Technical Skills', tagList(data.skills));
      if (data.softSkills.length) html += cvBlock('Soft Skills', tagList(data.softSkills));
      if (data.experience.length) html += cvBlock('Experience', data.experience.map(experienceEntry).join(''));
      if (data.education.length) html += cvBlock('Education', data.education.map(educationEntry).join(''));
      if (data.projects.length) html += cvBlock('Projects', data.projects.map(projectEntry).join(''));
      if (data.certifications.length) {
        html += cvBlock('Certifications', '<ul>' + data.certifications.map(function (c) {
          return '<li>' + escapeHtml(c.name) + (c.year ? ' \u2014 ' + escapeHtml(c.year) : '') + '</li>';
        }).join('') + '</ul>');
      }
      if (data.references.length) html += cvBlock('References', data.references.map(referenceEntry).join(''));

      el.lpcvPreview.innerHTML = html;

      var gain = estimateGain(data);
      el.lpcvImprovedGain.textContent = 'Your CV now covers ' + Math.min(100, 80 + gain) + '% of the sections recruiters look for.';
    }

    // generateCV(): validates required fields, runs the existing "rebuilding" animation,
    // then renders the final preview from collectFormData() only.
    function generateCV() {
      if (!validateStep1()) return;

      var data = collectFormData();
      show(el.lpcvForm, false);
      show(el.lpcvBuilding, true);
      el.lpcvBuilding.scrollIntoView({ behavior: 'smooth', block: 'center' });

      var duration = 3200 + Math.round(Math.random() * 1600);
      runSequence(el.lpcvBuildMsg, el.lpcvBuildBar, BUILD_MSGS, duration, function () {
        show(el.lpcvBuilding, false);
        renderFinalCV(data);
        setStep(4);
        show(el.lpcvImproved, true);
        el.lpcvImproved.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('\u2713 Your improved CV has been generated successfully.');
      });
    }

    /* -----------------------------------------------------------------------
       Download (unchanged behaviour — now serialises the real preview)
    ----------------------------------------------------------------------- */
    function buildDocument() {
      var body = el.lpcvPreview ? el.lpcvPreview.innerHTML : '';
      return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
        'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"><title>Improved CV</title><style>' +
        'body{font-family:Arial,Helvetica,sans-serif;color:#14202b;line-height:1.5;font-size:11pt;}' +
        'h2{font-size:20pt;margin:0;}h3{font-size:11pt;text-transform:uppercase;letter-spacing:1px;' +
        'border-bottom:1px solid #cccccc;padding-bottom:4px;margin:18px 0 6px;}' +
        'ul{margin:4px 0 0 18px;padding:0;}li{margin-bottom:3px;}' +
        '.lpcv-cv-tags{list-style:none;margin:6px 0 0;padding:0;}' +
        '.lpcv-cv-tags li{display:inline-block;margin:0 6px 4px 0;}' +
        '.lpcv-cv-entry-head span{color:#828282;}' +
        '</style></head><body>' + body + '</body></html>';
    }

    function downloadCV() {
      var blob = new Blob(['\ufeff', buildDocument()], { type: 'application/msword' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'Improved_CV.doc';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('\u2713 Improved_CV.doc downloaded');
    }

    /* -----------------------------------------------------------------------
       Wiring
    ----------------------------------------------------------------------- */
    function init() {
      cacheDom();
      if (!el.cvFileInput || !el.analyseBtn) return;

      el.cvFileInput.addEventListener('change', function () {
        if (el.cvFileInput.files && el.cvFileInput.files[0]) acceptFile(el.cvFileInput.files[0]);
      });

      ['dragenter', 'dragover'].forEach(function (evt) {
        el.lpcvDropzone.addEventListener(evt, function (e) { e.preventDefault(); el.lpcvDropzone.classList.add('is-drag'); });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        el.lpcvDropzone.addEventListener(evt, function (e) { e.preventDefault(); el.lpcvDropzone.classList.remove('is-drag'); });
      });
      el.lpcvDropzone.addEventListener('drop', function (e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) acceptFile(files[0]);
      });

      el.lpcvRemoveFile.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); removeFile(); });

      el.analyseBtn.addEventListener('click', generateAnalysis);
      el.lpcvGenerateBtn.addEventListener('click', showGenerationForm);
      el.lpcvDownloadBtn.addEventListener('click', downloadCV);

      // Details form wiring
      if (el.lpcvForm) {
        el.cvAddExperience.addEventListener('click', function () { addExperienceRow({}); });
        el.cvAddEducation.addEventListener('click', function () { addEducationRow({}); });
        el.cvAddProject.addEventListener('click', function () { addProjectRow({}); });
        el.cvAddCert.addEventListener('click', function () { addCertRow({}); });
        el.cvAddRef.addEventListener('click', function () { addReferenceRow({}); });

        el.lpcvFormBack.addEventListener('click', function () {
          if (formState.currentStep > 1) goToFormStep(formState.currentStep - 1);
        });
        el.lpcvFormNext.addEventListener('click', function () {
          if (formState.currentStep === 1 && !validateStep1()) return;
          if (formState.currentStep < 4) goToFormStep(formState.currentStep + 1);
        });
        Array.prototype.forEach.call(el.lpcvFormStepBtns, function (btn) {
          btn.addEventListener('click', function () {
            var s = Number(btn.getAttribute('data-fstep'));
            if (s > 1 && !validateStep1()) return;
            goToFormStep(s);
          });
        });
        el.lpcvBuildCvBtn.addEventListener('click', generateCV);
      }

      setStep(1);
    }

    return { init: init };
  })();

  LPCV.init();

  /* ---------------------------------------------
     Interview Arena — challenge bank + real execution
  --------------------------------------------- */
  var challenges = [
    { id: 7, title: 'FizzBuzz', difficulty: 'Easy', functionName: 'fizzBuzz',
      prompt: 'Return "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both, otherwise the number as a string.',
      hint: 'Check divisibility by 15 first.',
      starter: 'function fizzBuzz(n) {\n  // your code here\n}',
      tests: [{ args: [3], expected: 'Fizz' }, { args: [5], expected: 'Buzz' }, { args: [15], expected: 'FizzBuzz' }, { args: [7], expected: '7' }] },
    { id: 22, title: 'Find the Maximum', difficulty: 'Easy', functionName: 'findMax',
      prompt: 'Return the largest number in an array of numbers.',
      hint: 'Handle an array with just one element.',
      starter: 'function findMax(arr) {\n  // your code here\n}',
      tests: [{ args: [[1, 5, 3]], expected: 5 }, { args: [[-2, -9, -1]], expected: -1 }, { args: [[7]], expected: 7 }] },
    { id: 31, title: 'Palindrome Check', difficulty: 'Easy', functionName: 'isPalindrome',
      prompt: 'Return true if a string reads the same forward and backward (ignore case).',
      hint: 'Normalize case before comparing.',
      starter: 'function isPalindrome(str) {\n  // your code here\n}',
      tests: [{ args: ['level'], expected: true }, { args: ['Level'], expected: true }, { args: ['hello'], expected: false }] },
    { id: 63, title: 'Count Vowels', difficulty: 'Easy', functionName: 'countVowels',
      prompt: 'Count how many vowels (a, e, i, o, u) are in a string, case-insensitive.',
      hint: '"y" is not a vowel here.',
      starter: 'function countVowels(str) {\n  // your code here\n}',
      tests: [{ args: ['Hello World'], expected: 3 }, { args: ['xyz'], expected: 0 }] },
    { id: 14, title: 'Reverse a String', difficulty: 'Medium', functionName: 'reverseString',
      prompt: 'Build a function to reverse a string without using the built-in .reverse().',
      hint: 'Consider: empty strings, single characters, and spaces.',
      starter: 'function reverseString(str) {\n  // your code here\n}',
      tests: [{ args: ['hello'], expected: 'olleh' }, { args: [''], expected: '' }, { args: ['a'], expected: 'a' }, { args: ['a b c'], expected: 'c b a' }] },
    { id: 45, title: 'Two Sum', difficulty: 'Medium', functionName: 'twoSum',
      prompt: 'Given an array of numbers and a target, return the indices of the two numbers that add up to the target.',
      hint: 'A hash map gets you O(n).',
      starter: 'function twoSum(nums, target) {\n  // your code here\n}',
      tests: [{ args: [[2, 7, 11, 15], 9], expected: [0, 1] }, { args: [[3, 2, 4], 6], expected: [1, 2] }] },
    { id: 71, title: 'Flatten an Array', difficulty: 'Medium', functionName: 'flattenOnce',
      prompt: 'Flatten a nested array by one level deep, without using Array.flat.',
      hint: 'concat + spread can help.',
      starter: 'function flattenOnce(arr) {\n  // your code here\n}',
      tests: [{ args: [[1, [2, 3], [4]]], expected: [1, 2, 3, 4] }] },
    { id: 52, title: 'Debounce Function', difficulty: 'Hard', functionName: 'debounce',
      prompt: 'Implement debounce(fn, delay) that returns a debounced version of fn.',
      hint: 'This offline demo just checks that you return a function.',
      starter: 'function debounce(fn, delay) {\n  // your code here\n}',
      tests: [{ args: [function () {}, 100], expected: 'function', typeCheck: true }] }
  ];

  var solvedIds = JSON.parse(localStorage.getItem('lp_solved_challenges') || '[]');
  var currentChallenge = challenges[4]; // Reverse a String, matches original design
  var currentFilter = 'All';
  var codeEditor = document.getElementById('codeEditor');
  var langSelect = document.getElementById('langSelect');
  var testResultsEl = document.getElementById('testResults');

  var langStarters = {
    Python: function (c) { return 'def ' + c.functionName + '(...):\n    # your code here\n    pass'; },
    Java: function (c) { return '// Live execution supports JavaScript only in this browser demo.\n// Use this as a reference for your Java submission.\npublic Object ' + c.functionName + '(...) {\n    // your code here\n}'; }
  };

  function renderChallengeList() {
    var wrap = document.getElementById('challengeItems');
    wrap.innerHTML = '';
    challenges
      .filter(function (c) { return currentFilter === 'All' || c.difficulty === currentFilter; })
      .forEach(function (c) {
        var btn = document.createElement('button');
        btn.className = 'challenge-item' + (c.id === currentChallenge.id ? ' selected' : '');
        btn.innerHTML =
          '<span class="ci-title">' + (solvedIds.indexOf(c.id) > -1 ? '<span class="ci-check">✓</span>' : '') + escapeHtml(c.title) + '</span>' +
          '<span class="ci-diff ' + c.difficulty + '">' + c.difficulty + '</span>';
        btn.addEventListener('click', function () { loadChallenge(c); });
        wrap.appendChild(btn);
      });
  }

  document.querySelectorAll('.filter-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderChallengeList();
    });
  });

  function loadChallenge(c) {
    currentChallenge = c;
    document.getElementById('challengePill').textContent = 'Challenge #' + c.id + ' · ' + c.difficulty;
    document.getElementById('qTitle').textContent = c.title;
    document.getElementById('qDifficulty').textContent = c.difficulty;
    document.getElementById('qPrompt').textContent = c.prompt;
    document.getElementById('qHint').textContent = c.hint;
    langSelect.value = 'JavaScript';
    codeEditor.value = c.starter;
    testResultsEl.innerHTML = '';
    renderChallengeList();
  }

  langSelect.addEventListener('change', function () {
    var c = currentChallenge;
    if (langSelect.value === 'JavaScript') codeEditor.value = c.starter;
    else codeEditor.value = langStarters[langSelect.value](c);
    testResultsEl.innerHTML = '';
  });

  document.getElementById('resetCodeBtn').addEventListener('click', function () {
    codeEditor.value = langSelect.value === 'JavaScript' ? currentChallenge.starter : langStarters[langSelect.value](currentChallenge);
    testResultsEl.innerHTML = '';
  });

  function runChallenge(challenge, code) {
    if (langSelect.value !== 'JavaScript') {
      return { error: 'Live execution supports JavaScript only in this browser-based demo. Switch the language to JavaScript to run tests.' };
    }
    var fn;
    try {
      var factory = new Function(code + '\nreturn typeof ' + challenge.functionName + ' === "function" ? ' + challenge.functionName + ' : undefined;');
      fn = factory();
    } catch (e) {
      return { error: 'Syntax error: ' + e.message };
    }
    if (typeof fn !== 'function') {
      return { error: 'Could not find a function named "' + challenge.functionName + '". Keep that name so we can test it.' };
    }
    var results = challenge.tests.map(function (t) {
      var actual, threw = false, errMsg = '';
      try { actual = fn.apply(null, t.args); } catch (e) { threw = true; errMsg = e.message; }
      var pass;
      if (threw) pass = false;
      else if (t.typeCheck) pass = typeof actual === t.expected;
      else pass = JSON.stringify(actual) === JSON.stringify(t.expected);
      return { pass: pass, args: t.args, expected: t.expected, actual: threw ? ('threw: ' + errMsg) : actual };
    });
    return { results: results };
  }

  function renderTestResults(outcome) {
    testResultsEl.innerHTML = '';
    if (outcome.error) {
      var errDiv = document.createElement('div');
      errDiv.className = 'test-run-summary fail';
      errDiv.textContent = outcome.error;
      testResultsEl.appendChild(errDiv);
      return;
    }
    var passCount = outcome.results.filter(function (r) { return r.pass; }).length;
    var summary = document.createElement('div');
    summary.className = 'test-run-summary ' + (passCount === outcome.results.length ? 'pass' : 'fail');
    summary.textContent = passCount === outcome.results.length
      ? 'All ' + passCount + '/' + outcome.results.length + ' tests passed! ✓'
      : passCount + '/' + outcome.results.length + ' tests passed';
    testResultsEl.appendChild(summary);

    outcome.results.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'test-case-row ' + (r.pass ? 'pass' : 'fail');
      row.innerHTML = '<span class="tc-icon">' + (r.pass ? '✓' : '✕') + '</span> Test ' + (i + 1) + ': ' +
        escapeHtml(currentChallenge.functionName) + '(' + escapeHtml(JSON.stringify(r.args).slice(1, -1)) + ') → ' +
        (r.pass ? 'got ' + escapeHtml(JSON.stringify(r.actual)) : 'got ' + escapeHtml(JSON.stringify(r.actual)) + ', expected ' + escapeHtml(JSON.stringify(r.expected)));
      testResultsEl.appendChild(row);
    });

    if (passCount === outcome.results.length && solvedIds.indexOf(currentChallenge.id) === -1) {
      solvedIds.push(currentChallenge.id);
      localStorage.setItem('lp_solved_challenges', JSON.stringify(solvedIds));
      renderChallengeList();
    }
  }

  document.getElementById('runTestsBtn').addEventListener('click', function () {
    renderTestResults(runChallenge(currentChallenge, codeEditor.value));
  });

  document.getElementById('submitAnswerBtn').addEventListener('click', function () {
    var outcome = runChallenge(currentChallenge, codeEditor.value);
    renderTestResults(outcome);
    if (!outcome.error) {
      var passCount = outcome.results.filter(function (r) { return r.pass; }).length;
      alert(passCount === outcome.results.length
        ? 'Submitted — all tests passed on Challenge #' + currentChallenge.id + '!'
        : 'Submitted with ' + passCount + '/' + outcome.results.length + ' tests passing. Keep iterating!');
    }
  });

  renderChallengeList();
  loadChallenge(currentChallenge);

  /* ---------------------------------------------
     Home — render mentor grid from data
  --------------------------------------------- */
  function renderHomeMentors() {
    var wrap = document.getElementById('homeMentorGrid');
    if (!wrap) return;
    wrap.innerHTML = '';
    mentors.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'mentor-card';
      card.innerHTML =
        '<div class="mentor-avatar">' + avatarInner(m) + '</div>' +
        '<h3>' + escapeHtml(m.name) + '</h3>' +
        '<p>' + escapeHtml(m.role) + '</p>' +
        '<button class="btn btn-outline" data-nav="mentor" data-mentor-id="' + m.id + '">View Profile</button>';
      wrap.appendChild(card);
    });
  }
  renderHomeMentors();

  /* ---------------------------------------------
     Mentors — full browsable grid of every mentor
     (built-in + any created by mentor sign-ups)
  --------------------------------------------- */
  function renderMentorsList() {
    var grid = document.getElementById('mentorsListGrid');
    var emptyMsg = document.getElementById('mentorsListEmpty');
    var q = document.getElementById('mentorsListSearch').value.trim().toLowerCase();

    var list = mentors.filter(function (m) {
      if (!q) return true;
      return m.name.toLowerCase().indexOf(q) > -1 ||
        m.role.toLowerCase().indexOf(q) > -1 ||
        (m.location || '').toLowerCase().indexOf(q) > -1 ||
        m.skills.some(function (s) { return s.toLowerCase().indexOf(q) > -1; });
    });

    grid.innerHTML = '';
    emptyMsg.hidden = list.length > 0;
    list.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'mentor-card';
      card.innerHTML =
        '<div class="mentor-avatar">' + avatarInner(m) + '</div>' +
        '<h3>' + escapeHtml(m.name) + '</h3>' +
        '<p>' + escapeHtml(m.role) + (m.location ? ' · ' + escapeHtml(m.location) : '') + '</p>' +
        '<button class="btn btn-outline" data-nav="mentor" data-mentor-id="' + m.id + '">View Profile</button>';
      grid.appendChild(card);
    });
  }
  document.getElementById('mentorsListSearch').addEventListener('input', renderMentorsList);

  /* ---------------------------------------------
     Mentor Profile — tabs, reviews, switcher, real booking calendar
  --------------------------------------------- */
  function getMentor(id) { return mentors.find(function (m) { return m.id === id; }) || mentors[0]; }

  function avgRating(mentor) {
    if (!mentor.reviews.length) return 0;
    var sum = mentor.reviews.reduce(function (s, r) { return s + r.rating; }, 0);
    return sum / mentor.reviews.length;
  }

  function renderMentorProfile() {
    var m = getMentor(currentMentorId);
    document.getElementById('mentorName').textContent = m.name;
    document.getElementById('mentorRole').textContent = m.role;
    document.getElementById('mentorLocation').textContent = m.location;
    document.getElementById('mentorAvatarInitials').innerHTML = avatarInner(m);
    document.getElementById('mentorPhotoInitials').innerHTML = avatarInner(m);
    document.getElementById('mentorAboutTitle').textContent = 'About ' + m.name.split(' ')[m.name.split(' ').length - 1];
    document.getElementById('mentorAboutText').textContent = m.about;
    document.getElementById('bookingSub').textContent = 'Book a session with ' + m.name.split(' ')[0];

    var contactCard = document.getElementById('mentorContactCard');
    var contactLinks = [];
    if (m.contactEmail) contactLinks.push('<a class="contact-link" href="mailto:' + escapeHtml(m.contactEmail) + '"><svg width="16" height="16"><use href="#icon-user"/></svg>' + escapeHtml(m.contactEmail) + '</a>');
    if (m.contactPhone) contactLinks.push('<a class="contact-link" href="tel:' + escapeHtml(m.contactPhone.replace(/\s+/g, '')) + '"><svg width="16" height="16"><use href="#icon-user"/></svg>' + escapeHtml(m.contactPhone) + '</a>');
    if (m.linkedin) {
      var liHref = /^https?:\/\//.test(m.linkedin) ? m.linkedin : 'https://' + m.linkedin;
      contactLinks.push('<a class="contact-link" href="' + escapeHtml(liHref) + '" target="_blank" rel="noopener">' + escapeHtml(m.linkedin) + '</a>');
    }
    if (contactLinks.length) {
      contactCard.hidden = false;
      document.getElementById('mentorContactLinks').innerHTML = contactLinks.join('');
    } else {
      contactCard.hidden = true;
    }

    var avg = avgRating(m);
    document.getElementById('mentorRatingLine').textContent = (avg ? avg.toFixed(1) : '—') + ' (' + m.reviews.length + ' reviews)';
    document.getElementById('reviewsAvgScore').textContent = avg ? avg.toFixed(1) : '—';
    document.getElementById('reviewsAvgStars').textContent = '★★★★★'.slice(0, Math.round(avg)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(avg));
    document.getElementById('reviewsCount').textContent = m.reviews.length + ' reviews';

    var expWrap = document.getElementById('mentorExperienceList');
    expWrap.innerHTML = m.experience.map(function (ex) {
      return '<div class="cv-entry"><div class="cv-entry-head"><span>' + escapeHtml(ex.role) + ' — ' + escapeHtml(ex.company) + '</span><span>' + escapeHtml(ex.dates) + '</span></div></div>';
    }).join('') || '<p class="cv-empty">No experience listed.</p>';

    document.getElementById('mentorSkillChips').innerHTML = m.skills.map(function (s) {
      return '<span class="skill-chip">' + escapeHtml(s) + '</span>';
    }).join('');

    var reviewsWrap = document.getElementById('reviewsList');
    reviewsWrap.innerHTML = m.reviews.map(function (r) {
      return '<div class="review-item"><div class="review-item-head"><span>' + escapeHtml(r.name) + '</span><span class="stars">' + '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) + '</span></div><p>' + escapeHtml(r.comment) + '</p></div>';
    }).join('');

    var switchWrap = document.getElementById('mentorSwitchRow');
    switchWrap.innerHTML = '';
    mentors.forEach(function (mm) {
      var btn = document.createElement('button');
      btn.className = 'mentor-switch-card' + (mm.id === m.id ? ' active' : '');
      btn.innerHTML = '<div class="msc-avatar">' + avatarInner(mm) + '</div><h4>' + escapeHtml(mm.name) + '</h4><p>' + escapeHtml(mm.role) + '</p>';
      btn.addEventListener('click', function () { currentMentorId = mm.id; renderMentorProfile(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      switchWrap.appendChild(btn);
    });

    document.querySelectorAll('.tab-item').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-mtab') === 'about'); });
    document.querySelectorAll('.mentor-tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'mtab-about'); });

    selectedBookingDay = null;
    selectedBookingSlot = null;
    document.getElementById('bookingConfirmMsg').textContent = '';
    renderDayPicker();
  }

  document.querySelectorAll('.tab-item').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab-item').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.mentor-tab-panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('mtab-' + tab.getAttribute('data-mtab')).classList.add('active');
    });
  });

  document.querySelectorAll('[data-scroll-to]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.getElementById(btn.getAttribute('data-scroll-to'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  var TIME_SLOTS = ['09:00', '11:00', '13:00', '14:30', '16:00'];

  function renderDayPicker() {
    var wrap = document.getElementById('dayPicker');
    wrap.innerHTML = '';
    var today = new Date();
    for (var i = 0; i < 7; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var iso = d.toISOString().slice(0, 10);
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'day-chip' + (iso === selectedBookingDay ? ' selected' : '');
      chip.innerHTML = d.toLocaleDateString('en-ZA', { weekday: 'short' }) + '<span class="dc-date">' + d.getDate() + '</span>';
      chip.addEventListener('click', function () {
        var idx = Array.prototype.indexOf.call(wrap.children, this);
        var dd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + idx);
        selectedBookingDay = dd.toISOString().slice(0, 10);
        selectedBookingSlot = null;
        renderDayPicker();
        renderSlotPicker();
      });
      wrap.appendChild(chip);
    }
    renderSlotPicker();
  }

  function renderSlotPicker() {
    var wrap = document.getElementById('slotPicker');
    var confirmBtn = document.getElementById('confirmBookingBtn');
    wrap.innerHTML = '';
    if (!selectedBookingDay) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Select a day and time';
      return;
    }
    var takenSlots = bookings.filter(function (b) { return b.mentorId === currentMentorId && b.date === selectedBookingDay; }).map(function (b) { return b.time; });
    TIME_SLOTS.forEach(function (t) {
      var taken = takenSlots.indexOf(t) > -1;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'slot-chip' + (t === selectedBookingSlot ? ' selected' : '') + (taken ? ' taken' : '');
      chip.textContent = t;
      if (!taken) {
        chip.addEventListener('click', function () {
          selectedBookingSlot = t;
          renderSlotPicker();
        });
      }
      wrap.appendChild(chip);
    });
    confirmBtn.disabled = !selectedBookingSlot;
    confirmBtn.textContent = selectedBookingSlot ? 'Confirm ' + selectedBookingDay + ' at ' + selectedBookingSlot : 'Select a time';
  }

  document.getElementById('confirmBookingBtn').addEventListener('click', function () {
    if (!loggedIn) { navigate('signin'); return; }
    if (!selectedBookingDay || !selectedBookingSlot) return;
    var m = getMentor(currentMentorId);
    bookings.push({
      mentorId: m.id, mentorName: m.name,
      studentName: (currentUser && currentUser.name) || 'A student',
      studentEmail: (currentUser && currentUser.email) || '',
      studentPhone: (currentUser && currentUser.phone) || '',
      studentLinkedin: (currentUser && currentUser.linkedin) || '',
      date: selectedBookingDay, time: selectedBookingSlot, bookedAt: Date.now()
    });
    saveBookings();
    document.getElementById('bookingConfirmMsg').textContent = 'Booked! ' + m.name + ' on ' + selectedBookingDay + ' at ' + selectedBookingSlot + '.';
    selectedBookingSlot = null;
    renderSlotPicker();
  });

  /* Reviews */
  var pendingStarRating = 5;
  document.querySelectorAll('#starPicker [data-star]').forEach(function (starBtn) {
    starBtn.addEventListener('click', function () {
      pendingStarRating = parseInt(starBtn.getAttribute('data-star'), 10);
      document.querySelectorAll('#starPicker [data-star]').forEach(function (b) {
        b.classList.toggle('filled', parseInt(b.getAttribute('data-star'), 10) <= pendingStarRating);
      });
    });
  });
  document.querySelectorAll('#starPicker [data-star]').forEach(function (b) {
    b.classList.toggle('filled', parseInt(b.getAttribute('data-star'), 10) <= pendingStarRating);
  });

  document.getElementById('submitReviewBtn').addEventListener('click', function () {
    var text = document.getElementById('reviewText').value.trim();
    if (!text) return;
    var m = getMentor(currentMentorId);
    m.reviews.unshift({ name: currentUser ? currentUser.name : 'Anonymous student', rating: pendingStarRating, comment: text });
    document.getElementById('reviewText').value = '';
    renderMentorProfile();
    document.querySelectorAll('.tab-item').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-mtab') === 'reviews'); });
    document.querySelectorAll('.mentor-tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'mtab-reviews'); });
  });

  /* ---------------------------------------------
     User Profile — view/edit + progress + bookings
  --------------------------------------------- */
  function renderUserProfile() {
    if (!currentUser) return;
    document.getElementById('profileDisplayName').textContent = currentUser.name || 'Your Name';
    document.getElementById('profileAvatarInitials').innerHTML = currentUser.photo
      ? avatarInner(currentUser)
      : '<span style="font-weight:800;font-size:22px;">' + escapeHtml(initials(currentUser.name)) + '</span>';
    renderPPhotoPreview();
    document.getElementById('viewName').textContent = currentUser.name || '—';
    document.getElementById('viewEmail').textContent = currentUser.email || '—';
    document.getElementById('viewPhone').textContent = currentUser.phone || '—';
    document.getElementById('viewBio').textContent = currentUser.bio || '—';
    document.getElementById('viewLinkedin').textContent = currentUser.linkedin || '—';

    document.getElementById('progressChallenges').textContent = (JSON.parse(localStorage.getItem('lp_solved_challenges') || '[]')).length;
    var lastCv = localStorage.getItem('lp_last_cv_score');
    document.getElementById('progressCvScore').textContent = lastCv ? lastCv + '/100' : '—';
    var myBookings = bookings; // single-user demo, all bookings belong to current session
    document.getElementById('progressBookings').textContent = myBookings.length;

    var bookingsSection = document.getElementById('myBookingsSection');
    var bookingsList = document.getElementById('myBookingsList');
    if (myBookings.length) {
      bookingsSection.style.display = 'block';
      bookingsList.innerHTML = myBookings.map(function (b, i) {
        return '<div class="my-booking-row"><span>' + escapeHtml(b.mentorName) + ' — ' + escapeHtml(b.date) + ' at ' + escapeHtml(b.time) + '</span><button class="cancel-booking" data-cancel-booking="' + i + '">Cancel</button></div>';
      }).join('');
    } else {
      bookingsSection.style.display = 'none';
    }
  }

  document.getElementById('myBookingsList').addEventListener('click', function (e) {
    var idx = e.target.getAttribute('data-cancel-booking');
    if (idx === null) return;
    bookings.splice(idx, 1);
    saveBookings();
    renderUserProfile();
  });

  function renderPPhotoPreview() {
    var el = document.getElementById('pPhotoPreview');
    if (!el || !currentUser) return;
    el.innerHTML = currentUser.photo ? avatarInner(currentUser) : escapeHtml(initials(currentUser.name));
  }

  document.getElementById('pPhotoInput').addEventListener('change', function (e) {
    if (!currentUser || !e.target.files[0]) return;
    readImageAsDataUrl(e.target.files[0], 240, function (dataUrl) {
      currentUser.photo = dataUrl;
      saveCurrentUser();
      var users = loadUsers();
      var idx = users.findIndex(function (u) { return u.email.toLowerCase() === currentUser.email.toLowerCase(); });
      if (idx > -1) { users[idx].photo = dataUrl; saveUsers(users); }
      setLoggedIn(true);
      renderPPhotoPreview();
      document.getElementById('profileAvatarInitials').innerHTML = avatarInner(currentUser);
      showToast('Photo updated');
    });
  });
  document.getElementById('pPhotoRemoveBtn').addEventListener('click', function () {
    if (!currentUser) return;
    currentUser.photo = null;
    saveCurrentUser();
    var users = loadUsers();
    var idx = users.findIndex(function (u) { return u.email.toLowerCase() === currentUser.email.toLowerCase(); });
    if (idx > -1) { users[idx].photo = null; saveUsers(users); }
    setLoggedIn(true);
    renderPPhotoPreview();
    renderUserProfile();
  });

  document.getElementById('editProfileBtn').addEventListener('click', function () {
    document.getElementById('pName').value = currentUser.name || '';
    document.getElementById('pEmail').value = currentUser.email || '';
    document.getElementById('pPhone').value = currentUser.phone || '';
    document.getElementById('pBio').value = currentUser.bio || '';
    document.getElementById('pLinkedin').value = currentUser.linkedin || '';
    renderPPhotoPreview();
    document.getElementById('profileView').style.display = 'none';
    document.getElementById('profileEdit').style.display = 'block';
  });
  document.getElementById('cancelProfileEditBtn').addEventListener('click', function () {
    document.getElementById('profileEdit').style.display = 'none';
    document.getElementById('profileView').style.display = 'block';
  });
  document.getElementById('saveProfileBtn').addEventListener('click', function () {
    var newEmail = document.getElementById('pEmail').value.trim();
    if (!EMAIL_RE.test(newEmail)) { alert('Enter a valid email address.'); return; }
    currentUser.name = document.getElementById('pName').value.trim() || currentUser.name;
    currentUser.email = newEmail;
    currentUser.phone = document.getElementById('pPhone').value.trim();
    currentUser.bio = document.getElementById('pBio').value.trim();
    currentUser.linkedin = document.getElementById('pLinkedin').value.trim();
    saveCurrentUser();

    var users = loadUsers();
    var idx = users.findIndex(function (u) { return u.email.toLowerCase() === currentUser.email.toLowerCase() || u.username === currentUser.name; });
    if (idx > -1) { users[idx].username = currentUser.name; users[idx].phone = currentUser.phone; users[idx].bio = currentUser.bio; users[idx].linkedin = currentUser.linkedin; saveUsers(users); }

    document.getElementById('profileEdit').style.display = 'none';
    document.getElementById('profileView').style.display = 'block';
    setLoggedIn(true);
    renderUserProfile();
  });

  /* ---------------------------------------------
     Mentor Dashboard — mentor accounts manage their own public
     mentor profile: photo, role, location, about, skills, experience,
     plus a read-only list of session requests booked with them.
  --------------------------------------------- */
  function getCurrentMentorRecord() {
    if (!currentUser || currentUser.accountType !== 'mentor') return null;
    return mentors.find(function (m) { return m.id === currentUser.mentorId; }) || null;
  }

  function renderMentorDashboard() {
    var m = getCurrentMentorRecord();
    if (!m) return;
    document.getElementById('mdPhotoPreview').innerHTML = avatarInner(m);
    document.getElementById('mdName').value = m.name;
    document.getElementById('mdRole').value = m.role;
    document.getElementById('mdLocation').value = m.location;
    document.getElementById('mdAbout').value = m.about || '';
    document.getElementById('mdContactEmail').value = m.contactEmail || '';
    document.getElementById('mdContactPhone').value = m.contactPhone || '';
    document.getElementById('mdLinkedIn').value = m.linkedin || '';

    document.getElementById('mdSkillChips').innerHTML = m.skills.length
      ? m.skills.map(function (s, i) {
          return '<span class="skill-chip removable">' + escapeHtml(s) + '<button type="button" data-remove-skill="' + i + '" aria-label="Remove ' + escapeHtml(s) + '">&times;</button></span>';
        }).join('')
      : '<p class="cv-empty">No skills added yet.</p>';

    document.getElementById('mdExperienceList').innerHTML = m.experience.length
      ? m.experience.map(function (ex, i) {
          return '<div class="cv-entry"><div class="cv-entry-head"><span>' + escapeHtml(ex.role) + ' — ' + escapeHtml(ex.company) + '</span><span>' + escapeHtml(ex.dates) + '</span></div><button type="button" class="exp-remove" data-remove-exp="' + i + '">Remove</button></div>';
        }).join('')
      : '<p class="cv-empty">No experience listed yet.</p>';

    var myBookings = bookings.filter(function (b) { return b.mentorId === m.id; });
    document.getElementById('mdBookingsList').innerHTML = myBookings.length
      ? myBookings.map(function (b) {
          var contactBits = [];
          if (b.studentEmail) contactBits.push('<a href="mailto:' + escapeHtml(b.studentEmail) + '">' + escapeHtml(b.studentEmail) + '</a>');
          if (b.studentPhone) contactBits.push('<a href="tel:' + escapeHtml(b.studentPhone.replace(/\s+/g, '')) + '">' + escapeHtml(b.studentPhone) + '</a>');
          return '<div class="my-booking-row"><span>' + escapeHtml(b.studentName || 'A student') + ' — ' + escapeHtml(b.date) + ' at ' + escapeHtml(b.time) + '</span>' +
            (contactBits.length ? '<span class="booking-contact">' + contactBits.join(' · ') + '</span>' : '<span class="booking-contact muted">No contact details on file</span>') +
            '</div>';
        }).join('')
      : '<p class="cv-empty">No session requests yet.</p>';

    document.getElementById('mdViewPublicBtn').setAttribute('data-mentor-id', m.id);
  }

  document.getElementById('mdPhotoInput').addEventListener('change', function (e) {
    var m = getCurrentMentorRecord();
    if (!m || !e.target.files[0]) return;
    readImageAsDataUrl(e.target.files[0], 260, function (dataUrl) {
      m.photo = dataUrl;
      saveCustomMentors();
      renderMentorDashboard();
      renderHomeMentors();
      showToast('Photo updated');
    });
  });
  document.getElementById('mdPhotoRemoveBtn').addEventListener('click', function () {
    var m = getCurrentMentorRecord();
    if (!m) return;
    m.photo = null;
    saveCustomMentors();
    renderMentorDashboard();
    renderHomeMentors();
  });

  document.getElementById('mdSaveBtn').addEventListener('click', function () {
    var m = getCurrentMentorRecord();
    if (!m) return;
    m.name = document.getElementById('mdName').value.trim() || m.name;
    m.role = document.getElementById('mdRole').value.trim() || m.role;
    m.location = document.getElementById('mdLocation').value.trim() || m.location;
    m.about = document.getElementById('mdAbout').value.trim();
    m.contactEmail = document.getElementById('mdContactEmail').value.trim();
    m.contactPhone = document.getElementById('mdContactPhone').value.trim();
    m.linkedin = document.getElementById('mdLinkedIn').value.trim();
    saveCustomMentors();

    if (currentUser.name !== m.name) {
      currentUser.name = m.name;
      saveCurrentUser();
      var users = loadUsers();
      var idx = users.findIndex(function (u) { return u.mentorId === m.id; });
      if (idx > -1) { users[idx].username = m.name; saveUsers(users); }
      setLoggedIn(true);
    }
    renderHomeMentors();
    renderMentorDashboard();
    showToast('Profile saved');
  });

  function addMentorSkill() {
    var m = getCurrentMentorRecord();
    var input = document.getElementById('mdSkillInput');
    var val = input.value.trim();
    if (!m || !val) return;
    if (m.skills.indexOf(val) === -1) m.skills.push(val);
    input.value = '';
    saveCustomMentors();
    renderMentorDashboard();
  }
  document.getElementById('mdSkillAddBtn').addEventListener('click', addMentorSkill);
  document.getElementById('mdSkillInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addMentorSkill(); }
  });
  document.getElementById('mdSkillChips').addEventListener('click', function (e) {
    var idx = e.target.getAttribute('data-remove-skill');
    if (idx === null) return;
    var m = getCurrentMentorRecord();
    if (!m) return;
    m.skills.splice(idx, 1);
    saveCustomMentors();
    renderMentorDashboard();
  });

  document.getElementById('mdExpAddBtn').addEventListener('click', function () {
    var m = getCurrentMentorRecord();
    if (!m) return;
    var role = document.getElementById('mdExpRole').value.trim();
    var company = document.getElementById('mdExpCompany').value.trim();
    var dates = document.getElementById('mdExpDates').value.trim();
    if (!role || !company) { showToast('Add a role and company'); return; }
    m.experience.unshift({ role: role, company: company, dates: dates || 'Present' });
    document.getElementById('mdExpRole').value = '';
    document.getElementById('mdExpCompany').value = '';
    document.getElementById('mdExpDates').value = '';
    saveCustomMentors();
    renderMentorDashboard();
  });
  document.getElementById('mdExperienceList').addEventListener('click', function (e) {
    var idx = e.target.getAttribute('data-remove-exp');
    if (idx === null) return;
    var m = getCurrentMentorRecord();
    if (!m) return;
    m.experience.splice(idx, 1);
    saveCustomMentors();
    renderMentorDashboard();
  });

  document.getElementById('logoutBtn3').addEventListener('click', doLogout);
  document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);
  document.getElementById('deleteAccountBtn2').addEventListener('click', deleteAccount);

  /* ---------------------------------------------
     Subscription — real state, monthly/annual, cancel
  --------------------------------------------- */
  var monthlyToggle = document.getElementById('monthlyToggle');
  var annualToggle = document.getElementById('annualToggle');
  var proPrice = document.getElementById('proPrice');

  function renderSubscriptionState() {
    var isPro = subscription.plan === 'pro';
    document.getElementById('freePlanBtn').textContent = isPro ? 'Downgrade available' : 'Current Plan';
    document.getElementById('freePlanBtn').disabled = !isPro ? true : false;
    document.getElementById('proPlanBtn').textContent = isPro ? 'Current Plan' : 'Get Pro';
    document.getElementById('proPlanBtn').disabled = isPro;
    document.getElementById('proPlanBtn').removeAttribute('data-nav');
    if (!isPro) document.getElementById('proPlanBtn').setAttribute('data-nav', 'payment');
    document.getElementById('subCurrentPlanNote').textContent = isPro
      ? 'You are on the Pro plan (' + subscription.billing + ' billing). Manage it below.'
      : 'Unlock premium features to grow your career';
    document.getElementById('cancelSubWrap').style.display = isPro ? 'block' : 'none';

    if (subscription.billing === 'annual') {
      annualToggle.classList.add('active'); monthlyToggle.classList.remove('active');
      proPrice.innerHTML = 'R1690<small>/yr</small>';
    } else {
      monthlyToggle.classList.add('active'); annualToggle.classList.remove('active');
      proPrice.innerHTML = 'R169<small>/mo</small>';
    }
  }

  monthlyToggle.addEventListener('click', function () {
    subscription.billing = 'monthly';
    saveSubscription();
    renderSubscriptionState();
  });
  annualToggle.addEventListener('click', function () {
    subscription.billing = 'annual';
    saveSubscription();
    renderSubscriptionState();
  });

  document.getElementById('cancelSubBtn').addEventListener('click', function () {
    if (!confirm('Cancel your Pro subscription? You will move back to the Free plan.')) return;
    subscription.plan = 'free';
    saveSubscription();
    renderSubscriptionState();
    LPBackend.cancelSubscription().catch(function () {});
  });

  /* ---------------------------------------------
     Payment — method toggle, Luhn validation, persistence
  --------------------------------------------- */
  var selectedPayMethod = 'card';

  function renderPaymentPlanSummary() {
    var priceText = subscription.billing === 'annual' ? 'R1690/yr' : 'R169/mo';
    document.getElementById('paySelectedPlanText').textContent = 'Pro · ' + priceText;
    document.getElementById('subscribeBtn').textContent = 'Pay securely · ' + priceText;
  }

  document.getElementById('subscribeBtn').addEventListener('click', async function () {
    var btn = this, errEl = document.getElementById('payError');
    errEl.classList.remove('show');
    btn.disabled = true;
    try {
      var url = await LPBackend.startCheckout(subscription.billing === 'annual' ? 'annual' : 'monthly');
      window.location.href = url; // Paystack hosted checkout
    } catch (err) {
      errEl.textContent = err.message || 'Could not start checkout. Please try again.';
      errEl.classList.add('show');
      btn.disabled = false;
    }
  });

  // Back from Paystack (?reference=...): the server asks Paystack whether the payment really went through.
  (async function handlePaymentReturn() {
    var ref = new URLSearchParams(location.search).get('reference');
    if (!ref) return;
    history.replaceState(null, '', location.pathname + '#profile');
    try {
      var res = await LPBackend.confirmPayment(ref);
      if (res.ok) {
        subscription.plan = 'pro'; if (res.billing) subscription.billing = res.billing;
        saveSubscription(); renderSubscriptionState();
        showToast('Payment received — welcome to Pro!');
      } else {
        showToast('We could not confirm that payment. If you were charged, contact us.');
      }
    } catch (e) { showToast('Could not confirm payment right now.'); }
  })();

  /* ---------------------------------------------
     Contact details (editable by an admin) + contact form (saved in MySQL)
  --------------------------------------------- */
  function applySettings(st) {
    if (!st) return;
    document.querySelectorAll('[data-contact-email]').forEach(function (el) { el.textContent = st.contact_email; el.setAttribute('href', 'mailto:' + st.contact_email); });
    document.querySelectorAll('[data-contact-phone]').forEach(function (el) { el.textContent = st.contact_phone; el.setAttribute('href', 'tel:' + String(st.contact_phone).replace(/[^+\d]/g, '')); });
    document.querySelectorAll('[data-contact-hours]').forEach(function (el) { el.textContent = st.contact_hours; });
    document.querySelectorAll('[data-contact-location]').forEach(function (el) { el.textContent = st.contact_location; });
    document.querySelectorAll('[data-social]').forEach(function (el) {
      var url = st['social_' + el.getAttribute('data-social')];
      if (url) { el.setAttribute('href', url); el.style.display = ''; } else { el.style.display = 'none'; }
    });
  }
  LPBackend.getSettings().then(applySettings).catch(function () {});

  var contactFormEl = document.getElementById('contactForm');
  if (contactFormEl) {
    contactFormEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = document.getElementById('contactName').value.trim();
      var email = document.getElementById('contactEmail2').value.trim();
      var message = document.getElementById('contactMessage').value.trim();
      if (!name || !EMAIL_RE.test(email) || !message) {
        showToast('Please fill in your name, a valid email, and a message.');
        return;
      }
      var successEl = document.getElementById('contactSuccess');
      try {
        await LPBackend.sendContact({ name: name, email: email, message: message });
        successEl.textContent = 'Thanks, ' + name + ' — we\'ll get back to you at ' + email + ' soon.';
        successEl.classList.add('show');
        contactFormEl.reset();
      } catch (err) {
        showToast(err.message || 'Could not send your message. Please try again.');
      }
    });
  }

  /* ---------------------------------------------
     Admin panel (server checks ADMIN_EMAILS on every request)
  --------------------------------------------- */
  var adminTab = 'overview';
  function adminTable(cols, rows) {
    if (!rows.length) return '<p class="cv-empty">Nothing here yet.</p>';
    return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' + cols.map(function (c) { return '<th>' + escapeHtml(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + c.f(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function fmtDate(v) { return v ? escapeHtml(String(v).replace('T', ' ').slice(0, 16)) : '—'; }
  function esc2(v) { return escapeHtml(String(v == null ? '' : v)).replace(/"/g, '&quot;'); }

  async function renderAdmin() {
    var body = document.getElementById('adminBody');
    document.querySelectorAll('[data-admin-tab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-admin-tab') === adminTab); });
    body.innerHTML = 'Loading…';
    try {
      if (adminTab === 'overview') {
        var o = await LPBackend.admin.overview();
        body.innerHTML = '<div class="admin-stats">' +
          [['Users', o.users], ['Verified', o.verified], ['Mentors', o.mentors], ['Pro members', o.pro], ['Paid (R)', (o.paid / 100).toFixed(2)], ['Messages', o.messages]]
            .map(function (x) { return '<div class="admin-stat"><strong>' + x[1] + '</strong>' + x[0] + '</div>'; }).join('') + '</div>';
      } else if (adminTab === 'users') {
        var u = (await LPBackend.admin.users()).users;
        body.innerHTML = adminTable([
          { h: 'ID', f: function (r) { return r.id; } }, { h: 'Name', f: function (r) { return escapeHtml(r.name); } },
          { h: 'Email', f: function (r) { return escapeHtml(r.email) + (r.isAdmin ? ' <b>(admin)</b>' : ''); } },
          { h: 'Role', f: function (r) { return r.role; } }, { h: 'Verified', f: function (r) { return r.email_verified ? 'yes' : 'no'; } },
          { h: 'Plan', f: function (r) { return r.plan || 'free'; } }, { h: 'Joined', f: function (r) { return fmtDate(r.created_at); } },
          { h: '', f: function (r) { return r.isAdmin ? '' : '<button class="btn btn-danger-outline btn-sm" data-admin-del-user="' + r.id + '">Delete</button>'; } }
        ], u);
      } else if (adminTab === 'mentors') {
        var m = (await LPBackend.admin.mentors()).mentors;
        body.innerHTML = adminTable([
          { h: 'ID', f: function (r) { return r.id; } }, { h: 'Name', f: function (r) { return escapeHtml(r.name); } },
          { h: 'Role', f: function (r) { return escapeHtml(r.role_title) || '—'; } }, { h: 'Location', f: function (r) { return escapeHtml(r.location) || '—'; } },
          { h: 'Account email', f: function (r) { return escapeHtml(r.email); } }, { h: 'Verified', f: function (r) { return r.email_verified ? 'yes' : 'no'; } },
          { h: 'Joined', f: function (r) { return fmtDate(r.created_at); } },
          { h: '', f: function (r) { return '<button class="btn btn-danger-outline btn-sm" data-admin-del-user="' + r.user_id + '">Delete account</button>'; } }
        ], m);
      } else if (adminTab === 'payments') {
        var p = (await LPBackend.admin.payments()).payments;
        body.innerHTML = adminTable([
          { h: 'Reference', f: function (r) { return escapeHtml(r.reference); } }, { h: 'Email', f: function (r) { return escapeHtml(r.email); } },
          { h: 'Billing', f: function (r) { return r.billing; } }, { h: 'Amount', f: function (r) { return 'R' + (r.amount / 100).toFixed(2); } },
          { h: 'Status', f: function (r) { return r.status; } }, { h: 'Created', f: function (r) { return fmtDate(r.created_at); } }, { h: 'Paid', f: function (r) { return fmtDate(r.paid_at); } }
        ], p);
      } else if (adminTab === 'messages') {
        var ms = (await LPBackend.admin.messages()).messages;
        body.innerHTML = adminTable([
          { h: 'When', f: function (r) { return fmtDate(r.created_at); } }, { h: 'Name', f: function (r) { return escapeHtml(r.name); } },
          { h: 'Email', f: function (r) { return '<a href="mailto:' + esc2(r.email) + '">' + escapeHtml(r.email) + '</a>'; } },
          { h: 'Message', f: function (r) { return '<div class="admin-msg">' + escapeHtml(r.message) + '</div>'; } },
          { h: '', f: function (r) { return '<button class="btn btn-outline btn-sm" data-admin-del-msg="' + r.id + '">Delete</button>'; } }
        ], ms);
      } else if (adminTab === 'settings') {
        var st = await LPBackend.getSettings();
        function fld(id, label, val, type) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc2(val) + '"></div>'; }
        body.innerHTML = '<h3 style="margin-top:0;">Contact details shown on the website</h3>' +
          fld('adEmail', 'Contact email', st.contact_email, 'email') + fld('adPhone', 'Phone / WhatsApp', st.contact_phone) +
          fld('adHours', 'Opening hours text', st.contact_hours) + fld('adLocation', 'Location', st.contact_location) +
          fld('adLinkedin', 'LinkedIn link (https://…, blank hides it)', st.social_linkedin) + fld('adGithub', 'GitHub link', st.social_github) + fld('adInstagram', 'Instagram link', st.social_instagram) +
          '<div class="form-error" id="adSettingsError"></div><button class="btn btn-primary" id="adSaveSettings">Save contact details</button>';
      }
    } catch (err) {
      body.innerHTML = '<p class="form-error show">' + escapeHtml(err.message || 'Could not load this page.') + '</p>';
    }
  }

  document.getElementById('adminTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-admin-tab]');
    if (!b) return;
    adminTab = b.getAttribute('data-admin-tab');
    renderAdmin();
  });
  document.getElementById('adminBody').addEventListener('click', async function (e) {
    var du = e.target.closest('[data-admin-del-user]');
    var dm = e.target.closest('[data-admin-del-msg]');
    try {
      if (du) {
        if (!confirm('Delete this account and everything attached to it? This cannot be undone.')) return;
        await LPBackend.admin.deleteUser(du.getAttribute('data-admin-del-user'));
        refreshMentorsFromServer(); renderAdmin();
      } else if (dm) {
        await LPBackend.admin.deleteMessage(dm.getAttribute('data-admin-del-msg'));
        renderAdmin();
      } else if (e.target.id === 'adSaveSettings') {
        var errEl = document.getElementById('adSettingsError');
        errEl.classList.remove('show');
        try {
          var saved = await LPBackend.admin.saveSettings({
            contact_email: document.getElementById('adEmail').value, contact_phone: document.getElementById('adPhone').value,
            contact_hours: document.getElementById('adHours').value, contact_location: document.getElementById('adLocation').value,
            social_linkedin: document.getElementById('adLinkedin').value, social_github: document.getElementById('adGithub').value, social_instagram: document.getElementById('adInstagram').value
          });
          applySettings(saved);
          showToast('Contact details updated on the website');
        } catch (err) { errEl.textContent = err.message; errEl.classList.add('show'); }
      }
    } catch (err) { showToast(err.message || 'That did not work.'); }
  });

  /* ---------------------------------------------
     Continue with Outlook (Microsoft sign-in is done by the server;
     the result becomes a normal LaunchPad session via finishAuth)
  --------------------------------------------- */

  var MS_ERRORS = {
    cancelled: 'Microsoft sign-in was cancelled.',
    not_configured: 'Microsoft sign-in isn\'t set up on this server yet.',
    invalid_state: 'That Microsoft sign-in attempt wasn\'t valid. Please try again.',
    expired_state: 'That Microsoft sign-in took too long. Please try again.',
    no_code: 'Microsoft did not complete the sign-in. Please try again.',
    token_failed: 'Microsoft sign-in failed. Please try again.',
    graph_failed: 'We couldn\'t read your Microsoft account details. Please try again.',
    no_email: 'Your Microsoft account did not provide an email address, so we can\'t sign you in with it.',
    invalid_email: 'Your Microsoft account\'s email address isn\'t usable here.',
    microsoft_error: 'Microsoft could not sign you in. Please try again.',
    server_error: 'Something went wrong signing in with Microsoft. Please try again.'
  };
  // Back from Microsoft: either ?ms_error=<reason> or #ms_code=<one-time code>. The URL is cleaned straight away.
  (function handleMicrosoftReturn() {
    var msErr = new URLSearchParams(location.search).get('ms_error');
    var msCode = /^#ms_code=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!msErr && !msCode) return;
    history.replaceState(null, '', location.pathname + (msCode ? '#home' : '#signin'));
    if (msErr) {
      var el = document.getElementById('signinError');
      el.textContent = MS_ERRORS[msErr] || MS_ERRORS.microsoft_error;
      el.classList.add('show');
      return;
    }
    LPBackend.completeMicrosoftLogin(msCode[1]).then(function (su) {
      finishAuth(su);
    }).catch(function (err) {
      var el = document.getElementById('signinError');
      el.textContent = (err && err.message) || MS_ERRORS.server_error;
      el.classList.add('show');
      navigate('signin', { skipHistory: true, skipGate: true });
    });
  })();

  /* ---------------------------------------------
     Initial route
  --------------------------------------------- */
  if (currentUser) setLoggedIn(true);
  // Confirm the session with the server; if it's expired or invalid, sign out.
  if (currentUser) {
    LPBackend.getCurrentUser().then(function (u) {
      if (!u) { currentUser = null; localStorage.removeItem('lp_current_user'); setLoggedIn(false); navigate('signin', { skipHistory: true, skipGate: true }); return; }
      currentUser.isAdmin = !!u.isAdmin;
      saveCurrentUser();
      setLoggedIn(true);
      if (u.role === 'mentor') {
        LPBackend.getMyMentor().then(function (mm) {
          upsertMentor(toClientMentor(mm)); currentUser.mentorId = 'db' + String(mm.id).replace(/^db/, ''); saveCurrentUser();
          if (document.getElementById('screen-mentor-dashboard').classList.contains('active')) renderMentorDashboard();
        }).catch(function () {});
      }
      refreshMentorsFromServer();
    }).catch(function () {});
  }
  refreshMentorsFromServer();
  var initial = location.hash ? location.hash.slice(1) : 'home';
  // Only skip the gate for a bookmarked/shared link to a screen that's
  // actually public — a link straight to a gated screen (e.g. #cv-builder)
  // must still send a signed-out visitor to sign in first.
  navigate(initial, { skipHistory: true, skipGate: PUBLIC_ROUTES.indexOf(initial) > -1 });
})();

