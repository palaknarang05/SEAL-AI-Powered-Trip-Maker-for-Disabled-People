function sealAuthHeaders(extra) {
    const h = Object.assign({}, extra || {});
    const tok = localStorage.getItem('seal_token');
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
}

let modelsLoaded = false;
let currentFaceDescriptor = null;

async function loadModels() {
  if (modelsLoaded) return;
  // NOTE: a `assets/models/` folder existed in this repo but every weight
  // file in it was a saved "404: Not Found" page from a failed download —
  // not real model data, and not even using face-api.js's expected shard
  // naming convention. It's been removed. Self-hosting the real models is
  // a legitimate reliability improvement for later, but needs the actual
  // binary shards fetched correctly — not attempted here. For now this
  // loads from face-api.js's own model CDN, which is what was actually
  // working in this project before.
  const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
  await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  modelsLoaded = true;
}

// ---------------------------------------------------------
// Registration WebCam
// ---------------------------------------------------------
const btnOpenReg = document.getElementById('sealOpenRegisterModalBtn');
const regModal = document.getElementById('sealRegisterModal');
const btnCloseReg = document.getElementById('sealRegisterClose');
const btnCancelReg = document.getElementById('sealRegisterCancel');
const btnCaptureReg = document.getElementById('sealCaptureRegFaceBtn');
const regVideo = document.getElementById('sealRegVideo');
const regWebcamContainer = document.getElementById('sealRegWebcamContainer');
const regStatus = document.getElementById('sealRegFaceStatus');
const btnSubmitReg = document.getElementById('sealRegisterBtn');
const regForm = document.getElementById('sealRegisterForm');

let regStream = null;

btnOpenReg?.addEventListener('click', () => {
    document.getElementById('sealSignInModal')?.close();
    regModal?.showModal();
});

btnCloseReg?.addEventListener('click', stopRegWebcam);
btnCancelReg?.addEventListener('click', stopRegWebcam);

function stopRegWebcam() {
    if (regStream) {
        regStream.getTracks().forEach(track => track.stop());
        regStream = null;
    }
    regModal?.close();
}

btnCaptureReg?.addEventListener('click', async () => {
    try {
        regStatus.textContent = 'Loading models... please wait.';
        regWebcamContainer.style.display = 'block';
        await loadModels();
        regStatus.textContent = 'Starting webcam...';
        
        regStream = await navigator.mediaDevices.getUserMedia({ video: {} });
        regVideo.srcObject = regStream;
        
        regVideo.addEventListener('play', () => {
            regStatus.textContent = 'Analyzing face... please look at the camera.';
            const canvas = faceapi.createCanvasFromMedia(regVideo);
            // just to clear out old intervals
            const interval = setInterval(async () => {
                if(regVideo.paused || regVideo.ended) return clearInterval(interval);
                
                const detections = await faceapi.detectSingleFace(regVideo).withFaceLandmarks().withFaceDescriptor();
                if (detections) {
                    currentFaceDescriptor = Array.from(detections.descriptor);
                    regStatus.textContent = 'Face captured successfully!';
                    regStatus.style.color = 'green';
                    btnSubmitReg.disabled = false;
                    clearInterval(interval);
                    
                    // Stop video after successful capture
                    setTimeout(() => {
                        if (regStream) {
                            regStream.getTracks().forEach(track => track.stop());
                            regStream = null;
                        }
                    }, 1000);
                } else {
                    regStatus.textContent = 'No face detected. Please ensure your face is fully visible.';
                }
            }, 500);
        });
    } catch (err) {
        console.error(err);
        regStatus.textContent = 'Error starting webcam or loading models.';
    }
});

regForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentFaceDescriptor) return;

    const username = document.getElementById('sealRegUsername').value;
    const languageSelect = document.getElementById('sealRegLanguage');
    const language = languageSelect
        ? Array.from(languageSelect.selectedOptions).map((o) => o.value).join(', ')
        : '';
            const energyLevel = document.getElementById('sealRegEnergy').value;
    const role = document.getElementById("sealRegRole").value; const mobilityType = document.getElementById('sealRegMobility').value;
    const statusEl = document.getElementById('sealRegisterStatus');

    statusEl.textContent = 'Registering...';
    try {
        const res = await fetch('/api/register-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                language,
                energyLevel,
                mobilityType, role,
                preferences: {
                    wheelchairAccess: document.getElementById("sealRegPrefWheelchair").checked,
                    sensoryFriendly: document.getElementById("sealRegPrefSensory").checked,
                    strictVeg: document.getElementById("sealRegPrefVeg").checked,
                    petFriendly: document.getElementById("sealRegPrefPet").checked,
                    signLanguageGuide: document.getElementById("sealRegPrefSign").checked
                },
                faceDescriptor: currentFaceDescriptor
            })
        });
        
        const data = await res.json();
        if(res.ok) {
            statusEl.textContent = 'Registered successfully! You can now log in.';
            setTimeout(() => {
                regModal?.close();
            }, 1500);
        } else {
            statusEl.textContent = 'Error: ' + data.error;
        }
    } catch (err) {
        statusEl.textContent = 'Registration failed.';
    }
});

// ---------------------------------------------------------
// Login WebCam
// ---------------------------------------------------------
const btnFaceLogin = document.getElementById('sealFaceLoginBtn');
const loginVideo = document.getElementById('sealLoginVideo');
const loginWebcamContainer = document.getElementById('sealLoginWebcamContainer');
const loginStatus = document.getElementById('sealLoginFaceStatus');
const mainLoginStatus = document.getElementById('sealSignInStatus');

let loginStream = null;

btnFaceLogin?.addEventListener('click', async () => {
    const username = document.getElementById('sealSignInUsername').value;
    if (!username) {
        mainLoginStatus.textContent = 'Please enter your username first.';
        return;
    }

    try {
        loginStatus.textContent = 'Loading models... please wait.';
        loginWebcamContainer.style.display = 'block';
        await loadModels();
        loginStatus.textContent = 'Starting webcam...';
        
        loginStream = await navigator.mediaDevices.getUserMedia({ video: {} });
        loginVideo.srcObject = loginStream;
        
        loginVideo.addEventListener('play', () => {
            loginStatus.textContent = 'Analyzing face... please look at the camera.';
            const interval = setInterval(async () => {
                if(loginVideo.paused || loginVideo.ended) return clearInterval(interval);
                
                const detections = await faceapi.detectSingleFace(loginVideo).withFaceLandmarks().withFaceDescriptor();
                if (detections) {
                    clearInterval(interval);
                    loginStatus.textContent = 'Face detected. Verifying...';
                    
                    if (loginStream) {
                        loginStream.getTracks().forEach(track => track.stop());
                        loginStream = null;
                    }
                    
                    verifyLoginFace(username, Array.from(detections.descriptor));
                }
            }, 500);
        });
    } catch(err) {
        loginStatus.textContent = 'Error starting webcam.';
    }
});

async function verifyLoginFace(username, descriptor) {
    try {
        const res = await fetch('/api/login-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, faceDescriptor: descriptor })
        });
        const data = await res.json();
        
        if (res.ok) {
            loginStatus.textContent = 'Logged in successfully!';
            if (data.token) localStorage.setItem('seal_token', data.token);
            loginStatus.style.color = 'green';
            
            // Check role to see if we should redirect
            try {
                const profRes = await fetch('/api/profile/' + username, { headers: sealAuthHeaders() });
                if (profRes.ok) {
                    const profData = await profRes.json();
                    if (profData.role === 'consultant') {
                        localStorage.setItem('seal_logged_in_user', username);
                        window.location.href = '/consultant.html';
                        return;
                    }
                }
            } catch (e) {}

            mainLoginStatus.textContent = 'Welcome, ' + username; 
            loggedInUser = username; 
            localStorage.setItem('seal_logged_in_user', username);
            const btn = document.getElementById('sealSignInBtn') || document.querySelector('.signin-btn'); 
            if (btn) btn.innerHTML = '<span style="font-size:0.9rem; font-weight:bold; color:#38bdf8;">' + username.slice(0, 2).toUpperCase() + '</span>';
            
            setTimeout(() => {
                document.getElementById('sealSignInModal')?.close();
            }, 1500);
        } else {
            loginStatus.textContent = 'Verification failed: ' + (data.error || 'Face mismatch');
            loginStatus.style.color = 'red';
        }
    } catch(err) {
        loginStatus.textContent = 'Verification failed.';
    }
}

// ---------------------------------------------------------
// Profile UI
// ---------------------------------------------------------
let loggedInUser = null; // restored from the server session at the bottom of this file
const profileModal = document.getElementById('sealProfileModal');
const profileCloseBtn = document.getElementById('sealProfileClose');
const signOutBtn = document.getElementById('sealSignOutBtn');
const signinBtnIcon = document.getElementById('sealSignInBtn');

profileCloseBtn?.addEventListener('click', () => profileModal?.close());
signOutBtn?.addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST', headers: sealAuthHeaders() }).catch(() => {});
    loggedInUser = null; localStorage.removeItem('seal_logged_in_user'); localStorage.removeItem('seal_token');
    document.getElementById('myRequestsPanel')?.replaceChildren();
    profileModal?.close();
    signinBtnIcon.innerHTML = '<ion-icon name="person-circle-outline"></ion-icon>';
    alert('Signed out successfully.');
});

// Override the sign-in button click from accessibility.js
if (signinBtnIcon) {
    // We clone and replace to strip existing event listeners if needed, 
    // but the original just calls signInModal.showModal(). We'll just check state inside a new listener.
    // Actually cloning is safer so it doesn't open the login modal when logged in.
    const newBtn = signinBtnIcon.cloneNode(true);
    signinBtnIcon.parentNode.replaceChild(newBtn, signinBtnIcon);
    
    newBtn.addEventListener('click', async () => {
        if (loggedInUser) {
            // Fetch profile
            try {
                const res = await fetch('/api/profile/' + loggedInUser, { headers: sealAuthHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('profDisplayUsername').textContent = data.username;
                    
                    const role = data.role || 'user';
                    const roleDisplay = document.getElementById('profDisplayRole');
                    const travelerDetails = document.getElementById('profTravelerDetails');
                    const consultantDashboard = document.getElementById('profConsultantDashboard');
                    
                    if (role === 'consultant') {
                        // They shouldn't be here, they should be redirected!
                        window.location.href = '/consultant.html';
                        return;
                    } else {
                        roleDisplay.textContent = 'Traveler';
                        roleDisplay.style.background = '#38bdf8'; // blue for user
                        travelerDetails.style.display = 'block';
                        consultantDashboard.style.display = 'none';
                        
                        document.getElementById('profDisplayEnergy').textContent = data.energy_level || 'Not set';
                        document.getElementById('profDisplayMobility').textContent = data.mobility_type || 'None';
                        
                        const prefs = data.preferences || {};
                        const prefList = document.getElementById('profDisplayPrefs');
                        prefList.innerHTML = '';
                        const map = {
                            wheelchairAccess: 'Wheelchair Access',
                            sensoryFriendly: 'Sensory Friendly',
                            strictVeg: 'Strict Veg',
                            petFriendly: 'Pet Friendly',
                            signLanguageGuide: 'Sign Language'
                        };
                        for (const [k, v] of Object.entries(prefs)) {
                            if (v) {
                                const li = document.createElement('li');
                                li.textContent = map[k] || k;
                                prefList.appendChild(li);
                            }
                        }
                        if(prefList.children.length === 0) prefList.innerHTML = '<li>No specific preferences</li>';
                    }
                    
                    profileModal?.showModal();
                } else {
                    alert('Could not fetch profile');
                }
            } catch (err) {
                alert('Error fetching profile');
            }
        } else {
            // Open sign in modal
            document.getElementById('sealSignInStatus').textContent = '';
            document.getElementById('sealSignInModal')?.showModal();
        }
    });
}

// Open registration modal from the Consultant section and default to consultant role
const consultantRegBtn = document.getElementById('sealConsultantRegBtn');
consultantRegBtn?.addEventListener('click', () => {
    const roleSelect = document.getElementById('sealRegRole');
    if (roleSelect) {
        roleSelect.value = 'consultant';
    }
    document.getElementById('sealSignInModal')?.close();
    document.getElementById('sealRegisterModal')?.showModal();
});

// Dynamic role switching in Registration Modal
const regRoleSelect = document.getElementById('sealRegRole');
const regEnergy = document.getElementById('sealRegEnergy');
const regMobility = document.getElementById('sealRegMobility');
const regLanguage = document.getElementById('sealRegLanguage');

// We need the labels too. Let's find previous sibling labels.
if (regRoleSelect) {
    regRoleSelect.addEventListener('change', (e) => {
        const isConsultant = e.target.value === 'consultant';
        
        // Energy Level
        if (regEnergy) {
            regEnergy.style.display = isConsultant ? 'none' : 'block';
            if (regEnergy.previousElementSibling) regEnergy.previousElementSibling.style.display = isConsultant ? 'none' : 'block';
        }
        
        // Mobility Type
        if (regMobility) {
            regMobility.style.display = isConsultant ? 'none' : 'block';
            if (regMobility.previousElementSibling) regMobility.previousElementSibling.style.display = isConsultant ? 'none' : 'block';
        }
        
        // Preferences label text switch
        const prefTitle = document.querySelector('.seal-modal-form > p');
        if (prefTitle) {
            prefTitle.textContent = isConsultant ? 'Accessibility Specialties' : 'Accessibility Preferences (Check all that apply)';
        }
        
        // Language label text switch
        if (regLanguage && regLanguage.previousElementSibling) {
            regLanguage.previousElementSibling.textContent = isConsultant ? 'Languages Mastered' : 'Spoken/Sign Language';
        }
    });
    
    // Trigger once on load
    regRoleSelect.dispatchEvent(new Event('change'));
}


// ---------------------------------------------------------
// Restore a previous session (validated by the server, not trusted from localStorage)
// ---------------------------------------------------------
(async function restoreSession() {
    if (!localStorage.getItem('seal_token')) return;
    try {
        const res = await fetch('/api/me', { headers: sealAuthHeaders() });
        if (!res.ok) throw new Error('expired');
        const me = await res.json();
        loggedInUser = me.username;
        localStorage.setItem('seal_logged_in_user', me.username);
        const btn = document.getElementById('sealSignInBtn') || document.querySelector('.signin-btn');
        if (btn) btn.innerHTML = '<span style="font-size:0.9rem; font-weight:bold; color:#38bdf8;">' + me.username.slice(0, 2).toUpperCase() + '</span>';
        if (typeof loadMyRequests === 'function') loadMyRequests();
    } catch (e) {
        localStorage.removeItem('seal_token');
        localStorage.removeItem('seal_logged_in_user');
    }
})();
