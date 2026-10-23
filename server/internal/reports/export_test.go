package reports

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func sampleReport(rows int) *Report {
	rep := &Report{Type: "trips", Title: "Trips", From: base, To: base.Add(48 * time.Hour), Timezone: "UTC",
		Subtitle: "Somali café test – ünïcode",
		Columns: []Column{colDevice,
			col("start", "Start", KindDatetime, "", 0),
			col("distance", "Distance", KindNumber, "km", 2),
			col("duration", "Duration", KindDuration, "", 0),
			col("maxSpeed", "Max speed", KindSpeed, "km/h", 0),
			col("amount", "Amount", KindMoney, "USD", 2),
			col("address", "Location", KindText, "", 0),
		},
		Totals:    map[string]any{"distance": 12.5 * float64(rows), "duration": 3723.0 * float64(rows)},
		Subtotals: []Subtotal{{Label: "fuel", Values: map[string]any{"amount": 10.0}}},
	}
	for i := 0; i < rows; i++ {
		rep.Rows = append(rep.Rows, Row{"deviceId": int64(1), "device": fmt.Sprintf("Truck %02d", i),
			"start": base.Add(time.Duration(i) * time.Hour), "distance": 12.5, "duration": 3723.0, "maxSpeed": 88.0,
			"amount": 1234.5, "address": "Maka Al Mukarama Road, Hodan, Muqdisho — a very long address that needs truncation"})
	}
	rep.Rows = append(rep.Rows, Row{"device": "Empty", "start": nil, "distance": nil})
	return rep
}

func TestCSV(t *testing.T) {
	var buf bytes.Buffer
	loc := time.FixedZone("EAT", 3*3600)
	if err := WriteCSV(&buf, sampleReport(2), loc); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	if !bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("missing BOM")
	}
	recs, err := csv.NewReader(bytes.NewReader(b[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 1+3+2 { // header, rows, total, subtotal
		t.Fatalf("records %d: %v", len(recs), recs)
	}
	if strings.Join(recs[0], "|") != "Vehicle|Start|Distance (km)|Duration|Max speed (km/h)|Amount (USD)|Location" {
		t.Fatalf("header %v", recs[0])
	}
	if got := strings.Join(recs[1][:6], "|"); got != "Truck 00|2026-10-20 11:00|12.50|1:02:03|88|1234.50" {
		t.Fatalf("row %v", got)
	}
	if recs[3][1] != "" || recs[4][0] != "Total" || recs[4][2] != "25.00" || recs[4][3] != "2:04:06" ||
		recs[5][0] != "Total fuel" || recs[5][5] != "10.00" {
		t.Fatalf("footer %v %v %v", recs[3], recs[4], recs[5])
	}
}

func TestXLSX(t *testing.T) {
	var buf bytes.Buffer
	gen := base.Add(50 * time.Hour)
	if err := WriteXLSX(&buf, sampleReport(3), time.UTC, gen); err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if sheets := f.GetSheetList(); len(sheets) != 2 || sheets[0] != "Trips" || sheets[1] != "Info" {
		t.Fatalf("sheets %v", sheets)
	}
	rows, err := f.GetRows("Trips")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1+4+2 || rows[0][2] != "Distance (km)" || rows[1][0] != "Truck 00" || rows[5][0] != "Total" {
		t.Fatalf("rows %v", rows)
	}
	// Typed cells: numbers and dates are numeric with formats.
	if v, _ := f.GetCellValue("Trips", "C2", excelize.Options{RawCellValue: true}); v != "12.5" {
		t.Fatalf("distance raw %q", v)
	}
	if v, _ := f.GetCellValue("Trips", "B2"); v != "2026-10-20 08:00" {
		t.Fatalf("start formatted %q", v)
	}
	if v, _ := f.GetCellValue("Trips", "D2"); v != "1:02:03" {
		t.Fatalf("duration formatted %q", v)
	}
	if v, _ := f.GetCellValue("Trips", "C6"); v != "37.50" {
		t.Fatalf("total %q", v)
	}
	panes, err := f.GetPanes("Trips")
	if err != nil || !panes.Freeze || panes.YSplit != 1 {
		t.Fatalf("panes %+v %v", panes, err)
	}
	if w, _ := f.GetColWidth("Trips", "G"); w < 30 {
		t.Fatalf("address width %v", w)
	}
	st, _ := f.GetCellStyle("Trips", "A1")
	style, _ := f.GetStyle(st)
	if style == nil || style.Font == nil || !style.Font.Bold || len(style.Fill.Color) == 0 || style.Fill.Color[0] != "222D5D" {
		t.Fatalf("header style %+v", style)
	}
	if v, _ := f.GetCellValue("Info", "B2"); v != "Trips" {
		t.Fatalf("info %q", v)
	}
}

func TestPDF(t *testing.T) {
	var buf bytes.Buffer
	if err := WritePDF(&buf, sampleReport(120), time.UTC, base); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	if !bytes.HasPrefix(b, []byte("%PDF-")) {
		t.Fatal("not a PDF")
	}
	pages := len(regexp.MustCompile(`/Type /Page\b`).FindAll(b, -1))
	if pages < 4 {
		t.Fatalf("pages %d", pages)
	}
	// Empty report still renders one page.
	buf.Reset()
	empty := &Report{Type: "stops", Title: "Stops", From: base, To: base, Columns: []Column{colDevice}}
	if err := WritePDF(&buf, empty, nil, base); err != nil || !bytes.HasPrefix(buf.Bytes(), []byte("%PDF-")) {
		t.Fatalf("empty: %v", err)
	}
}

func TestFilename(t *testing.T) {
	rep := &Report{Type: "trips", From: base, To: base.Add(30 * time.Hour)}
	if got := Filename(rep, nil, FormatXLSX); got != "trips_2026-10-20_2026-10-21.xlsx" {
		t.Fatal(got)
	}
	if FormatDuration(-61) != "-0:01:01" || FormatDuration(90061) != "25:01:01" {
		t.Fatal("durations")
	}
}
