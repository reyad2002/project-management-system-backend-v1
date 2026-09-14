import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../lib/notifications.js";

// ----- Dashboard (team_member) -----

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { is_read, limit } = req.query;
    const isRead = is_read === undefined ? undefined : is_read === "true";

    const result = await listNotifications({
      companyId,
      recipientType: "team_member",
      recipientId: userId,
      isRead,
      limit,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markRead(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const data = await markNotificationRead({
      companyId,
      recipientType: "team_member",
      recipientId: userId,
      notificationId: req.params.id,
    });
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markAllRead(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    await markAllNotificationsRead({ companyId, recipientType: "team_member", recipientId: userId });
    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Portal (client_portal_user) -----

export async function listPortal(req, res) {
  try {
    const { company_id: companyId, id: portalUserId } = req.portalUser;

    const { is_read, limit } = req.query;
    const isRead = is_read === undefined ? undefined : is_read === "true";

    const result = await listNotifications({
      companyId,
      recipientType: "client_portal_user",
      recipientId: portalUserId,
      isRead,
      limit,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markReadPortal(req, res) {
  try {
    const { company_id: companyId, id: portalUserId } = req.portalUser;

    const data = await markNotificationRead({
      companyId,
      recipientType: "client_portal_user",
      recipientId: portalUserId,
      notificationId: req.params.id,
    });
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markAllReadPortal(req, res) {
  try {
    const { company_id: companyId, id: portalUserId } = req.portalUser;

    await markAllNotificationsRead({ companyId, recipientType: "client_portal_user", recipientId: portalUserId });
    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
