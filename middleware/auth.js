const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    // Save the intended destination to session
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
};

const isStaff = (req, res, next) => {
    const allowedRoles = ['host', 'staff', 'owner'];
    const userType = (req.user?.type || "").toLowerCase();
    if (req.isAuthenticated() && allowedRoles.some(role => userType.includes(role))) {
        return next();
    }
    res.status(403).json({ error: 'Staff access required' });
};

const isHostOrOwner = (req, res, next) => {
    const allowedRoles = ['host', 'owner'];
    const userType = (req.user?.type || "").toLowerCase();
    if (req.isAuthenticated() && allowedRoles.some(role => userType.includes(role))) {
        return next();
    }
    res.status(403).json({ error: 'Host or Owner access required' });
};

const isOwner = (req, res, next) => {
    if (req.isAuthenticated() && req.user.type.toLowerCase().includes('owner')) {
        return next();
    }
    res.status(403).json({ error: 'Owner access required' });
};

const canAccessMascot = (req, res, next) => {
    if (req.isAuthenticated() && (req.user.hasMascotAccess || req.user.type.toLowerCase().includes('owner'))) {
        return next();
    }
    res.status(403).json({ error: 'Mascot account access not authorized' });
};

module.exports = {
    isAuthenticated,
    isStaff,
    isHostOrOwner,
    isOwner,
    canAccessMascot
};
