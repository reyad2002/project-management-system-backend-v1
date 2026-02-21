# Last Updates: Payment Summary & Phases

This document describes the **payment-summary** endpoint and the **phases** API (all operations by project id).

---

## 1. Client Payment Summary

**Endpoint:** `GET /api/clients/:id/payment-summary`

Returns aggregated payment information for a client (all projects linked to that client).

### Authentication

- Requires `requireSupabase` and `requireAuth` (same as other `/api/clients` routes).

### URL Parameters

| Parameter | Description |
|-----------|--------------|
| `id`      | Client ID    |

### Response

```json
{
  "client_id": "123",
  "total_amount_to_pay": 50000,
  "amount_paid": 20000,
  "remaining": 30000
}
```

| Field                 | Description                                                                 |
|-----------------------|-----------------------------------------------------------------------------|
| `client_id`           | The client id from the URL.                                                |
| `total_amount_to_pay` | Sum of `projects.price` for all projects where `client_id` = this client.  |
| `amount_paid`         | Sum of `payments.amount` for those projects.                               |
| `remaining`           | `total_amount_to_pay - amount_paid`.                                       |

### Errors

- `401` – Not authenticated.
- `400` – Missing client id.
- `404` – Client not found (or not in your company).
- `500` – Server error.

### Route Registration

- **Route:** `GET /:id/payment-summary` in `api/routes/clients.js` (must be defined **before** `GET /:id` so the path is matched correctly).
- **Controller:** `getPaymentSummary` in `api/controllers/clientsController.js`.

---

## 2. Phases (All Operations by Project ID)

All phase operations are scoped by **project id**. There is no standalone `/api/phases` router; everything lives under **`/api/projects/:id/phases`**.

### Base Path

- **Project id:** `:id` in the URL is always the **project** id.
- **Phase id:** Used only in get/update/delete as `:phaseId`.

### Endpoints

| Method   | Path                                  | Description |
|----------|----------------------------------------|-------------|
| `GET`    | `/api/projects/:id/phases`             | List phases for the project. Optional query: `page`, `limit`. |
| `GET`    | `/api/projects/:id/phases/:phaseId`    | Get one phase (must belong to this project). |
| `POST`   | `/api/projects/:id/phases`            | Create a phase for this project. Project id comes from URL only. |
| `PUT`    | `/api/projects/:id/phases/:phaseId`   | Update a phase (must belong to this project). |
| `DELETE` | `/api/projects/:id/phases/:phaseId`   | Delete a phase (must belong to this project). |

### Request/Response Overview

- **List**  
  - Query: `page` (default `1`), `limit` (default `20`, max `100`).  
  - Response: `{ phases: [...], pagination: { page, limit, total } }`.

- **Get one**  
  - Response: Single phase object.

- **Create (POST)**  
  - Body: `start_date`, `end_date`, `amount`, `title`, `notes` (no `project_id` in body).  
  - Response: `201` with created phase.

- **Update (PUT)**  
  - Body: any of `start_date`, `end_date`, `amount`, `title`, `notes`.  
  - Response: Updated phase object.

- **Delete**  
  - Response: `204` No Content.

### Validation Rules (Phases)

1. **Dates**  
   - Phase `start_date` and `end_date` must be within the project’s `start_date` and `due_date`.  
   - Phase `end_date` must be on or after `start_date`.

2. **Amount**  
   - The sum of all phase `amount` values for the project must be **≤** the project’s `price`.  
   - Checked on create and update (other phases for the same project are included).

### Errors

- `401` – Not authenticated.
- `400` – Missing project/phase id, validation error (dates or amount), or no fields to update.
- `404` – Project not found, phase not found, or phase does not belong to the given project.
- `500` – Server error.

### Route Registration

- **Routes:** In `api/routes/projects.js` (see “All phase operations by project id” block).
- **Controller:** `api/controllers/phasesController.js`  
  - `listByProject`, `getOneByProject`, `createByProject`, `updateByProject`, `removeByProject`.

---

## File Reference

| Feature           | Routes File              | Controller File              |
|------------------|--------------------------|------------------------------|
| Payment summary  | `api/routes/clients.js`  | `api/controllers/clientsController.js` |
| Phases           | `api/routes/projects.js` | `api/controllers/phasesController.js`  |
