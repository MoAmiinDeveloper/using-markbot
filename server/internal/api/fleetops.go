package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	driverNotFound      = "driver not found"
	maintenanceNotFound = "maintenance item not found"
	reminderNotFound    = "reminder not found"
	expenseNotFound     = "expense not found"
	shareNotFound       = "share link not found"
)

// errGone maps expired/revoked share links to 410.
var errGone = store.ErrShareGone

// --- drivers ---

// driverVisible: drivers assigned to a vehicle follow its visibility;
// unassigned drivers are visible to everyone.
func driverVisible(all bool, ids map[int64]bool, d *store.Driver) bool {
	return all || d.DeviceID == nil || ids[*d.DeviceID]
}

// checkDriverRef validates an optional driver reference: it must exist and
// be visible to the caller (400 otherwise).
func (s *Server) checkDriverRef(r *http.Request, id *int64) error {
	if id == nil {
		return nil
	}
	d, err := s.store.Driver(r.Context(), *id)
	all, ids := s.deviceScope(r)
	if err != nil || !driverVisible(all, ids, &d) {
		return &store.ValidationError{Msg: "unknown driverId"}
	}
	return nil
}

// visibleDriver loads {id} and checks visibility (404 otherwise).
func (s *Server) visibleDriver(w http.ResponseWriter, r *http.Request) (store.Driver, bool) {
	id, err := pathID(r)
	var d store.Driver
	if err == nil {
		d, err = s.store.Driver(r.Context(), id)
	}
	if all, ids := s.deviceScope(r); err == nil && !driverVisible(all, ids, &d) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, driverNotFound)
		return d, false
	}
	return d, true
}

func (s *Server) handleListDrivers(w http.ResponseWriter, r *http.Request) {
	ds, err := s.store.Drivers(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	all, ids := s.deviceScope(r)
	out := make([]store.Driver, 0, len(ds))
	for i := range ds {
		if driverVisible(all, ids, &ds[i]) {
			out = append(out, ds[i])
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateDriver(w http.ResponseWriter, r *http.Request) {
	var in store.DriverInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkDeviceRef(r, in.DeviceID); err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.CreateDriver(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, driverNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

// optString is a nullable string in a PATCH body (absent = unchanged).
type optString struct {
	Set bool
	V   *string
}

func (o *optString) UnmarshalJSON(b []byte) error {
	o.Set = true
	return json.Unmarshal(b, &o.V)
}

func (s *Server) handleUpdateDriver(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleDriver(w, r)
	if !ok {
		return
	}
	var req struct {
		Name          *string    `json:"name"`
		Phone         *string    `json:"phone"`
		LicenseNumber *string    `json:"licenseNumber"`
		LicenseExpiry optString  `json:"licenseExpiry"`
		Tag           *string    `json:"tag"`
		DeviceID      optionalID `json:"deviceId"`
		Notes         *string    `json:"notes"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.DeviceID.Set {
		if err := s.checkDeviceRef(r, req.DeviceID.ID); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	d, err := s.store.UpdateDriver(r.Context(), cur.ID, store.DriverPatch{
		Name: req.Name, Phone: req.Phone, LicenseNumber: req.LicenseNumber,
		LicenseExpiry: req.LicenseExpiry.V, LicenseSet: req.LicenseExpiry.Set,
		Tag: req.Tag, DeviceID: req.DeviceID.ID, DeviceIDSet: req.DeviceID.Set, Notes: req.Notes,
	})
	if err != nil {
		s.failAs(w, r, err, driverNotFound)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleDeleteDriver(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleDriver(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteDriver(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, driverNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- maintenance ---

func (s *Server) visibleMaintenance(w http.ResponseWriter, r *http.Request) (store.Maintenance, bool) {
	id, err := pathID(r)
	var m store.Maintenance
	if err == nil {
		m, err = s.store.MaintenanceItem(r.Context(), id)
	}
	if err == nil && !s.canSeeDevice(r, m.DeviceID) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, maintenanceNotFound)
		return m, false
	}
	return m, true
}

func (s *Server) handleListMaintenance(w http.ResponseWriter, r *http.Request) {
	deviceID, err := queryID(r, "deviceId")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	ms, err := s.store.MaintenanceList(r.Context(), s.storeScope(r), deviceID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ms)
}

func (s *Server) handleCreateMaintenance(w http.ResponseWriter, r *http.Request) {
	var in store.MaintenanceInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkDeviceRef(r, in.DeviceID); err != nil {
		s.fail(w, r, err)
		return
	}
	m, err := s.store.CreateMaintenance(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, maintenanceNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleUpdateMaintenance(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleMaintenance(w, r)
	if !ok {
		return
	}
	var in store.MaintenanceInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkDeviceRef(r, in.DeviceID); err != nil {
		s.fail(w, r, err)
		return
	}
	m, err := s.store.UpdateMaintenance(r.Context(), cur.ID, in)
	if err != nil {
		s.failAs(w, r, err, maintenanceNotFound)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleDeleteMaintenance(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleMaintenance(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteMaintenance(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, maintenanceNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCompleteMaintenance returns the reset Maintenance item.
func (s *Server) handleCompleteMaintenance(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleMaintenance(w, r)
	if !ok {
		return
	}
	var in store.CompleteInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	m, _, err := s.store.CompleteMaintenance(r.Context(), cur.ID, in)
	if err != nil {
		s.failAs(w, r, err, maintenanceNotFound)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleMaintenanceHistory(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleMaintenance(w, r)
	if !ok {
		return
	}
	recs, err := s.store.ServiceHistory(r.Context(), cur.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

// --- reminders ---

func (s *Server) visibleReminder(w http.ResponseWriter, r *http.Request) (store.Reminder, bool) {
	id, err := pathID(r)
	var rm store.Reminder
	if err == nil {
		rm, err = s.store.Reminder(r.Context(), id)
	}
	if all, ids := s.deviceScope(r); err == nil && !rm.VisibleIn(all, ids) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, reminderNotFound)
		return rm, false
	}
	return rm, true
}

func (s *Server) handleListReminders(w http.ResponseWriter, r *http.Request) {
	var f store.ReminderFilter
	var err error
	if f.DeviceID, err = queryID(r, "deviceId"); err == nil {
		f.DriverID, err = queryID(r, "driverId")
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	rs, err := s.store.Reminders(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	all, ids := s.deviceScope(r)
	out := make([]store.Reminder, 0, len(rs))
	for i := range rs {
		if rs[i].VisibleIn(all, ids) {
			out = append(out, rs[i])
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) checkReminderRefs(r *http.Request, in *store.ReminderInput) error {
	if in.DeviceID.Set {
		if err := s.checkDeviceRef(r, in.DeviceID.ID); err != nil {
			return err
		}
	}
	if in.DriverID.Set {
		return s.checkDriverRef(r, in.DriverID.ID)
	}
	return nil
}

func (s *Server) handleCreateReminder(w http.ResponseWriter, r *http.Request) {
	var in store.ReminderInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkReminderRefs(r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	rm, err := s.store.CreateReminder(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, reminderNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, rm)
}

func (s *Server) handleUpdateReminder(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleReminder(w, r)
	if !ok {
		return
	}
	var in store.ReminderInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkReminderRefs(r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	rm, err := s.store.UpdateReminder(r.Context(), cur.ID, in)
	if err != nil {
		s.failAs(w, r, err, reminderNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rm)
}

func (s *Server) handleDeleteReminder(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleReminder(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteReminder(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, reminderNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- expenses ---

func (s *Server) visibleExpense(w http.ResponseWriter, r *http.Request) (store.Expense, bool) {
	id, err := pathID(r)
	var e store.Expense
	if err == nil {
		e, err = s.store.Expense(r.Context(), id)
	}
	if err == nil && !s.canSeeDevice(r, e.DeviceID) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, expenseNotFound)
		return e, false
	}
	return e, true
}

func (s *Server) handleListExpenses(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.ExpenseFilter{Category: q.Get("category")}
	var err error
	if f.DeviceID, err = queryID(r, "deviceId"); err != nil {
		s.fail(w, r, err)
		return
	}
	for _, p := range []struct {
		name string
		dst  *string
	}{{"from", &f.From}, {"to", &f.To}} {
		v := q.Get(p.name)
		if v == "" {
			continue
		}
		// Dates or RFC 3339 times (the date part is used).
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			v = t.UTC().Format(time.DateOnly)
		}
		if _, err := store.ParseDate(p.name, v); err != nil {
			s.fail(w, r, err)
			return
		}
		*p.dst = v
	}
	es, err := s.store.Expenses(r.Context(), s.storeScope(r), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, es)
}

func (s *Server) checkExpenseRefs(r *http.Request, in *store.ExpenseInput) error {
	if err := s.checkDeviceRef(r, in.DeviceID); err != nil {
		return err
	}
	if in.DriverID.Set {
		return s.checkDriverRef(r, in.DriverID.ID)
	}
	return nil
}

func (s *Server) handleCreateExpense(w http.ResponseWriter, r *http.Request) {
	var in store.ExpenseInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkExpenseRefs(r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	e, err := s.store.CreateExpense(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, expenseNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) handleUpdateExpense(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleExpense(w, r)
	if !ok {
		return
	}
	var in store.ExpenseInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkExpenseRefs(r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	e, err := s.store.UpdateExpense(r.Context(), cur.ID, in)
	if err != nil {
		s.failAs(w, r, err, expenseNotFound)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleDeleteExpense(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleExpense(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteExpense(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, expenseNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- share links ---

const (
	defaultShareHours = 24
	maxShareHours     = 24 * 30
)

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	var req struct {
		Hours *float64 `json:"hours"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	hours := float64(defaultShareHours)
	if req.Hours != nil {
		hours = *req.Hours
	}
	if !(hours > 0 && hours <= maxShareHours) {
		writeError(w, http.StatusBadRequest, "hours must be between 0 and 720")
		return
	}
	l, err := s.store.CreateShare(r.Context(), id, principalFrom(r.Context()).UserID, time.Duration(hours*float64(time.Hour)))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, l)
}

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	ls, err := s.store.Shares(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ls)
}

func (s *Server) handleRevokeShare(w http.ResponseWriter, r *http.Request) {
	l, err := s.store.Share(r.Context(), chi.URLParam(r, "token"))
	if err == nil && !s.canSeeDevice(r, l.DeviceID) {
		err = store.ErrNotFound
	}
	if err == nil {
		err = s.store.RevokeShare(r.Context(), l.Token)
	}
	if err != nil {
		s.failAs(w, r, err, shareNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// publicPosition is Position without identifying fields (IMEI).
type publicPosition struct {
	Time       time.Time      `json:"time"`
	Lat        float64        `json:"lat"`
	Lng        float64        `json:"lng"`
	Altitude   float64        `json:"altitude"`
	Speed      float64        `json:"speed"`
	Course     float64        `json:"course"`
	Valid      bool           `json:"valid"`
	Attributes map[string]any `json:"attributes"`
}

// publicAttrs are the attributes a public share reveals.
var publicAttrs = []string{domain.AttrIgnition, domain.AttrMotion}

func (s *Server) handlePublicShare(w http.ResponseWriter, r *http.Request) {
	l, err := s.store.ActiveShare(r.Context(), chi.URLParam(r, "token"))
	var d store.Device
	if err == nil {
		d, err = s.store.Device(l.DeviceID)
	}
	if err != nil {
		s.failAs(w, r, err, shareNotFound)
		return
	}
	var pos *publicPosition
	if p := d.Position; p != nil {
		pos = &publicPosition{Time: p.DeviceTime, Lat: p.Latitude, Lng: p.Longitude, Altitude: p.Altitude,
			Speed: p.Speed, Course: p.Course, Valid: p.Valid, Attributes: map[string]any{}}
		for _, k := range publicAttrs {
			if v, ok := p.Attributes[k]; ok {
				pos.Attributes[k] = v
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"name": d.Name, "category": d.Category, "position": pos, "status": d.Status, "expiresAt": l.ExpiresAt,
	})
}
