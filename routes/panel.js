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
router.get('/mascot', isAuthenticated, canAccessMascot, (req, res) => { 
    res.render('panel/mascot', { 
        user: req.user, 
        page: 'mascot',
        mascotEmail: process.env.VRC_EMAIL || 'Not Configured',
        mascotPassword: process.env.VRC_PASSWORD || 'Not Configured'
    }); 
});

module.exports = router;
