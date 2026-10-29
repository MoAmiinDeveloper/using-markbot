package store

import (
	"net/mail"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// DeviceIcons lists the map icons a device can use; "" keeps the status arrow.
var DeviceIcons = []string{"car", "taxi", "van", "pickup", "truck", "tanker", "bus", "motorcycle", "tractor",
	"ambulance", "forklift", "excavator", "trailer", "caravan", "boat", "person", "asset"}

// FuelTypes lists the allowed vehicle fuel types ("" = not set).
var FuelTypes = []string{"petrol", "diesel", "electric", "hybrid", "lpg", "cng", "other"}

// DeviceDetails holds the registration data that has no behaviour attached.
type DeviceDetails struct {
	Vehicle VehicleInfo `json:"vehicle"`
	SIM     SIMInfo     `json:"sim"`
	Owner   OwnerInfo   `json:"owner"`
	Notes   string      `json:"notes"`
}

// VehicleInfo describes the vehicle the tracker is installed in.
type VehicleInfo struct {
	VIN          string `json:"vin"`
	Make         string `json:"make"`
	Model        string `json:"model"`
	Year         int    `json:"year"` // 0 = not set
	Color        string `json:"color"`
	FuelType     string `json:"fuelType"`
	EngineNumber string `json:"engineNumber"`
}

// SIMInfo describes the tracker SIM card and installation.
type SIMInfo struct {
	ICCID              string `json:"iccid"`
	Operator           string `json:"operator"`
	InstallDate        string `json:"installDate"` // YYYY-MM-DD
	Installer          string `json:"installer"`
	SubscriptionExpiry string `json:"subscriptionExpiry"` // YYYY-MM-DD
}

// OwnerInfo is the customer the vehicle belongs to.
type OwnerInfo struct {
	Name     string `json:"name"`
	Company  string `json:"company"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Address  string `json:"address"`
	IDNumber string `json:"idNumber"`
}

var (
	dateRe  = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
	vinRe   = regexp.MustCompile(`^[A-HJ-NPR-Z0-9]{11,17}$`)
	iccidRe = regexp.MustCompile(`^\d{18,22}F?$`)
	phoneRe = regexp.MustCompile(`^\+?[\d\s()-]{5,24}$`)
)

func normalizeDetails(d *DeviceDetails) error {
	text := []struct {
		f    *string
		name string
		max  int
	}{
		{&d.Vehicle.VIN, "VIN", 17}, {&d.Vehicle.Make, "make", 40}, {&d.Vehicle.Model, "vehicle model", 40},
		{&d.Vehicle.Color, "colour", 30}, {&d.Vehicle.FuelType, "fuel type", 16}, {&d.Vehicle.EngineNumber, "engine number", 40},
		{&d.SIM.ICCID, "ICCID", 22}, {&d.SIM.Operator, "SIM operator", 40}, {&d.SIM.InstallDate, "install date", 10},
		{&d.SIM.Installer, "installer", 64}, {&d.SIM.SubscriptionExpiry, "subscription expiry", 10},
		{&d.Owner.Name, "owner name", 100}, {&d.Owner.Company, "owner company", 100}, {&d.Owner.Phone, "owner phone", 24},
		{&d.Owner.Email, "owner email", 120}, {&d.Owner.Address, "owner address", 300}, {&d.Owner.IDNumber, "owner ID number", 40},
		{&d.Notes, "notes", 2000},
	}
	for _, t := range text {
		*t.f = strings.TrimSpace(*t.f)
		if utf8.RuneCountInString(*t.f) > t.max {
			return invalid("%s must be at most %d characters", t.name, t.max)
		}
	}
	d.Vehicle.VIN = strings.ToUpper(d.Vehicle.VIN)
	d.Vehicle.FuelType = strings.ToLower(d.Vehicle.FuelType)
	d.SIM.ICCID = strings.ToUpper(strings.ReplaceAll(d.SIM.ICCID, " ", ""))
	switch {
	case d.Vehicle.VIN != "" && !vinRe.MatchString(d.Vehicle.VIN):
		return invalid("VIN must be 11–17 letters and digits (no I, O or Q)")
	case d.Vehicle.Year != 0 && (d.Vehicle.Year < 1950 || d.Vehicle.Year > 2100):
		return invalid("year must be between 1950 and 2100")
	case d.Vehicle.FuelType != "" && !slices.Contains(FuelTypes, d.Vehicle.FuelType):
		return invalid("fuel type must be one of: %s", strings.Join(FuelTypes, ", "))
	case d.SIM.ICCID != "" && !iccidRe.MatchString(d.SIM.ICCID):
		return invalid("ICCID must be 18–22 digits")
	case d.SIM.InstallDate != "" && !dateRe.MatchString(d.SIM.InstallDate):
		return invalid("install date must be YYYY-MM-DD")
	case d.SIM.SubscriptionExpiry != "" && !dateRe.MatchString(d.SIM.SubscriptionExpiry):
		return invalid("subscription expiry must be YYYY-MM-DD")
	case d.Owner.Phone != "" && !phoneRe.MatchString(d.Owner.Phone):
		return invalid("owner phone is not a valid phone number")
	}
	if d.Owner.Email != "" {
		if a, err := mail.ParseAddress(d.Owner.Email); err != nil || a.Address != d.Owner.Email {
			return invalid("owner email is not a valid address")
		}
	}
	return nil
}
