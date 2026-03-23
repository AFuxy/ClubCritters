const express = require('express');
const router = express.Router();
const passport = require('passport');

// Auth Routes
router.get('/discord', (req, res, next) => {
    // 1. Check session for returnTo first, then query, then Referer
    let returnTo = req.session.returnTo || req.query.returnTo || req.get('Referer') || '/';
    
    // 2. Safety: Never redirect back to auth or login-error
    if (returnTo.includes('/auth/discord') || returnTo.includes('/login-error')) {
        returnTo = '/';
    }

    // 3. Safety: Clean returnTo if it's a full URL
    if (returnTo.includes(req.get('host'))) {
        try {
            const url = new URL(returnTo, `http://${req.get('host')}`);
            returnTo = url.pathname + url.search;
        } catch (e) { returnTo = '/'; }
    } else if (returnTo.startsWith('http')) {
        returnTo = '/'; // Don't redirect to external sites
    }

    console.log(`[AUTH] 🔑 Starting Login. Target: ${returnTo}`);
    
    // Pass returnTo as state
    const state = Buffer.from(returnTo).toString('base64');
    passport.authenticate('discord', { state, prompt: 'none' })(req, res, next);
});

router.get('/discord/callback', (req, res, next) => {
    let returnTo = '/';
    if (req.query.state) {
        try {
            returnTo = Buffer.from(req.query.state, 'base64').toString('ascii');
        } catch (e) { console.error("[AUTH] ❌ Failed to decode state", e); }
    }

    passport.authenticate('discord', { failureRedirect: '/login-error' })(req, res, async (err) => {
        if (err) return next(err);
        if (!req.user) return res.redirect('/login-error');

        // Clear the session returnTo now that we used it
        delete req.session.returnTo;

        console.log(`[AUTH] ✅ Login Success: ${req.user.name}. Redirect: ${returnTo}`);

        if (!req.user.isPublic && returnTo === '/') {
            return res.redirect('/panel');
        }

        res.redirect(returnTo);
    });
});

router.get('/logout', (req, res) => {
    req.logout(() => { res.redirect('/'); });
});

module.exports = router;
