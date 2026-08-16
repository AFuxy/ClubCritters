function getUserRoles(user) {
    if (!user || !user.type) return [];
    if (Array.isArray(user.type)) return user.type.map(r => String(r).toLowerCase().trim()).filter(Boolean);
    const raw = String(user.type).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(r => String(r).toLowerCase().trim()).filter(Boolean);
        } catch(e) {}
    }
    return raw.split(/\s*,\s*|\s*\/\s*/).map(r => r.toLowerCase().trim()).filter(Boolean);
}

function hasRole(user, targetRole) {
    const roles = getUserRoles(user);
    const target = targetRole.toLowerCase().trim();
    return roles.some(r => r.includes(target));
}

function hasAnyRole(user, targetRoles) {
    const roles = getUserRoles(user);
    return targetRoles.some(t => {
        const target = t.toLowerCase().trim();
        return roles.some(r => r.includes(target));
    });
}

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
};

const isStaff = (req, res, next) => {
    if (req.isAuthenticated() && hasAnyRole(req.user, ['host', 'staff', 'owner'])) {
        return next();
    }
    res.status(403).json({ error: 'Staff access required' });
};

const isHostOrOwner = (req, res, next) => {
    if (req.isAuthenticated() && hasAnyRole(req.user, ['host', 'owner'])) {
        return next();
    }
    res.status(403).json({ error: 'Host or Owner access required' });
};

const isOwner = (req, res, next) => {
    if (req.isAuthenticated() && hasRole(req.user, 'owner')) {
        return next();
    }
    res.status(403).json({ error: 'Owner access required' });
};

const canAccessMascot = (req, res, next) => {
    if (req.isAuthenticated() && (req.user.hasMascotAccess || hasRole(req.user, 'owner'))) {
        return next();
    }
    res.status(403).json({ error: 'Mascot account access not authorized' });
};

const isPartnerOrStaff = (req, res, next) => {
    const allowedRoles = ['partner', 'host', 'staff', 'owner', 'resident'];
    if (req.isAuthenticated() && hasAnyRole(req.user, allowedRoles)) {
        return next();
    }
    res.status(403).json({ error: 'Partner or Staff access required' });
};

module.exports = {
    getUserRoles,
    hasRole,
    hasAnyRole,
    isAuthenticated,
    isStaff,
    isHostOrOwner,
    isOwner,
    canAccessMascot,
    isPartnerOrStaff
};

