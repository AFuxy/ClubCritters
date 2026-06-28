const express = require('express');
const router = express.Router();
const { isAuthenticated, isStaff, canAccessMascot } = require('../middleware/auth');

// --- PANEL ROUTES ---

router.get('/', isAuthenticated, (req, res) => { res.redirect('/panel/profile'); });
router.get('/profile', isAuthenticated, (req, res) => { res.render('panel/profile', { user: req.user, page: 'profile' }); });
router.get('/schedule', isAuthenticated, isStaff, (req, res) => { res.render('panel/schedule', { user: req.user, page: 'schedule' }); });
router.get('/roster', isAuthenticated, isStaff, (req, res) => { res.render('panel/roster', { user: req.user, page: 'roster' }); });
router.get('/apps', isAuthenticated, isStaff, (req, res) => { res.render('panel/apps', { user: req.user, page: 'apps' }); });
router.get('/settings', isAuthenticated, isStaff, (req, res) => { res.render('panel/settings', { user: req.user, page: 'settings' }); });
router.get('/stats', isAuthenticated, isStaff, (req, res) => { res.render('panel/stats', { user: req.user, page: 'stats' }); });
router.get('/links', isAuthenticated, isStaff, (req, res) => { res.render('panel/links', { user: req.user, page: 'links', vrcGroupId: process.env.VRC_GROUPID || 'FURN.9601' }); });
router.get('/archives', isAuthenticated, (req, res) => { res.render('panel/archives', { user: req.user, page: 'archives' }); });
const crypto = require('crypto');

router.get('/camera-token', isAuthenticated, canAccessMascot, (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    global.cameraTokens = global.cameraTokens || new Map();
    global.cameraTokens.set(token, {
        userId: req.user.discordId,
        username: req.user.name,
        expires: Date.now() + 5 * 60 * 1000 // Valid for 5 minutes
    });
    res.json({ token });
});

router.get('/mascot', isAuthenticated, canAccessMascot, (req, res) => { 
    const token = crypto.randomBytes(16).toString('hex');
    global.cameraTokens = global.cameraTokens || new Map();
    global.cameraTokens.set(token, {
        userId: req.user.discordId,
        username: req.user.name,
        expires: Date.now() + 5 * 60 * 1000 // Valid for 5 minutes
    });

    res.render('panel/mascot', { 
        user: req.user, 
        page: 'mascot',
        mascotEmail: process.env.VRC_EMAIL || 'Not Configured',
        mascotPassword: process.env.VRC_PASSWORD || 'Not Configured',
        cameraWsToken: token
    }); 
});

router.get('/world-image', isAuthenticated, canAccessMascot, async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl || (!imageUrl.startsWith('https://api.vrchat.cloud') && !imageUrl.startsWith('https://files.vrchat.cloud'))) {
        return res.status(400).send("Invalid image URL");
    }

    const vrcApi = require('../utils/vrc-api');
    try {
        const cookie = await vrcApi.getAuthCookie();
        
        const response = await fetch(imageUrl, {
            headers: {
                'Cookie': cookie || '',
                'User-Agent': 'ClubFuRNHub/1.0.0'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send("Failed to fetch image from VRChat");
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        
        // Cache for 10 minutes
        res.setHeader('Cache-Control', 'public, max-age=600');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (e) {
        console.error("[IMAGE PROXY] Error proxying image:", e);
        res.status(500).send("Error proxying image");
    }
});

module.exports = router;
