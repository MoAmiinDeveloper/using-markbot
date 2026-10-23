package reports

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
)

// Export formats.
const (
	FormatJSON = "json"
	FormatCSV  = "csv"
	FormatXLSX = "xlsx"
	FormatPDF  = "pdf"
)

// ContentType returns the MIME type of an export format.
func ContentType(format string) string {
	switch format {
	case FormatCSV:
		return "text/csv; charset=utf-8"
	case FormatXLSX:
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case FormatPDF:
		return "application/pdf"
	}
	return "application/json"
}

// Filename returns the download name, e.g. "trips_2026-10-01_2026-10-22.xlsx".
func Filename(rep *Report, loc *time.Location, format string) string {
	if loc == nil {
		loc = time.UTC
	}
	return fmt.Sprintf("%s_%s_%s.%s", rep.Type, rep.From.In(loc).Format(time.DateOnly),
		rep.To.In(loc).Format(time.DateOnly), format)
}

// Brand colors.
var (
	navy = [3]int{0x22, 0x2D, 0x5D}
	gold = [3]int{0xFF, 0xD7, 0x00}
)

// BrandName is printed in exported headers.
const BrandName = "Somtel Fleet"

const exportTimeLayout = "2006-01-02 15:04"

// headerLabel is the column label with its unit.
func headerLabel(c Column) string {
	if c.Unit != "" {
		return c.Label + " (" + c.Unit + ")"
	}
	return c.Label
}

func isNumeric(kind string) bool {
	return kind == KindNumber || kind == KindSpeed || kind == KindMoney || kind == KindDuration
}

// toFloat converts numeric row values.
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case *float64:
		if x != nil {
			return *x, true
		}
	}
	return 0, false
}

func toTime(v any) (time.Time, bool) {
	switch x := v.(type) {
	case time.Time:
		return x, !x.IsZero()
	case *time.Time:
		if x != nil {
			return *x, true
		}
	}
	return time.Time{}, false
}

// FormatDuration renders seconds as h:mm:ss.
func FormatDuration(sec float64) string {
	s := int64(math.Round(sec))
	neg := s < 0
	if neg {
		s = -s
	}
	out := fmt.Sprintf("%d:%02d:%02d", s/3600, s/60%60, s%60)
	if neg {
		out = "-" + out
	}
	return out
}

// formatValue renders a cell as text (CSV and PDF).
func formatValue(c Column, v any, loc *time.Location) string {
	if v == nil {
		return ""
	}
	switch c.Kind {
	case KindDatetime:
		if t, ok := toTime(v); ok {
			return t.In(loc).Format(exportTimeLayout)
		}
	case KindDuration:
		if f, ok := toFloat(v); ok {
			return FormatDuration(f)
		}
	case KindNumber, KindSpeed, KindMoney:
		if f, ok := toFloat(v); ok {
			d := c.Decimals
			if c.Kind == KindMoney {
				d = 2
			}
			return strconv.FormatFloat(f, 'f', d, 64)
		}
	}
	switch x := v.(type) {
	case string:
		return x
	case *string:
		if x != nil {
			return *x
		}
		return ""
	case bool:
		if x {
			return "yes"
		}
		return "no"
	}
	return fmt.Sprint(v)
}

// footerRows returns the totals and subtotals as rows (first column holds
// the label), for exports.
func footerRows(rep *Report) []Row {
	var out []Row
	if len(rep.Columns) == 0 {
		return nil
	}
	first := rep.Columns[0].Key
	if len(rep.Totals) > 0 {
		r := Row{}
		for k, v := range rep.Totals {
			r[k] = v
		}
		r[first] = "Total"
		out = append(out, r)
	}
	for _, s := range rep.Subtotals {
		r := Row{}
		for k, v := range s.Values {
			r[k] = v
		}
		r[first] = "Total " + s.Label
		out = append(out, r)
	}
	return out
}

// footerColumn adapts a column for a footer row: the first column is a label.
func footerColumn(c Column, i int) Column {
	if i == 0 {
		c.Kind = KindText
	}
	return c
}

// WriteCSV writes the report as UTF-8 CSV with a BOM (so Excel detects the
// encoding), a header row, the rows and the totals.
func WriteCSV(w io.Writer, rep *Report, loc *time.Location) error {
	if loc == nil {
		loc = time.UTC
	}
	if _, err := io.WriteString(w, "\xEF\xBB\xBF"); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	rec := make([]string, len(rep.Columns))
	for i, c := range rep.Columns {
		rec[i] = headerLabel(c)
	}
	if err := cw.Write(rec); err != nil {
		return err
	}
	write := func(row Row, footer bool) error {
		for i, c := range rep.Columns {
			if footer {
				c = footerColumn(c, i)
			}
			rec[i] = formatValue(c, row[c.Key], loc)
		}
		return cw.Write(rec)
	}
	for _, row := range rep.Rows {
		if err := write(row, false); err != nil {
			return err
		}
	}
	for _, row := range footerRows(rep) {
		if err := write(row, true); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// excelSerial converts a time to an Excel date serial using the wall clock
// in loc (Excel has no time zones).
func excelSerial(t time.Time, loc *time.Location) float64 {
	lt := t.In(loc)
	wall := time.Date(lt.Year(), lt.Month(), lt.Day(), lt.Hour(), lt.Minute(), lt.Second(), 0, time.UTC)
	return float64(wall.Unix())/86400 + 25569
}

// sheetName sanitizes a worksheet name (max 31 chars, no []:*?/\).
func sheetName(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return '-'
		}
		return r
	}, s)
	if utf8.RuneCountInString(s) > 31 {
		s = string([]rune(s)[:31])
	}
	if s == "" {
		s = "Report"
	}
	return s
}

// columnWidths estimates character widths from the header and up to 500 rows.
func columnWidths(rep *Report, loc *time.Location) []float64 {
	ws := make([]float64, len(rep.Columns))
	for i, c := range rep.Columns {
		ws[i] = float64(utf8.RuneCountInString(headerLabel(c)))
	}
	for n, row := range rep.Rows {
		if n >= 500 {
			break
		}
		for i, c := range rep.Columns {
			ws[i] = max(ws[i], float64(utf8.RuneCountInString(formatValue(c, row[c.Key], loc))))
		}
	}
	return ws
}

// WriteXLSX writes the report as an Excel workbook: a data sheet with a
// styled, frozen header row, typed cells (numbers, durations, dates), column
// widths and a totals row, plus an info sheet with title and period.
func WriteXLSX(w io.Writer, rep *Report, loc *time.Location, generated time.Time) error {
	if loc == nil {
		loc = time.UTC
	}
	f := excelize.NewFile()
	defer f.Close()
	name := sheetName(rep.Title)
	if err := f.SetSheetName("Sheet1", name); err != nil {
		return err
	}
	hex := func(c [3]int) string { return fmt.Sprintf("%02X%02X%02X", c[0], c[1], c[2]) }
	headerStyle, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{hex(navy)}},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
		Border:    []excelize.Border{{Type: "bottom", Color: hex(gold), Style: 5}},
	})
	if err != nil {
		return err
	}
	styleFor := func(c Column, bold bool) (int, error) {
		st := &excelize.Style{Font: &excelize.Font{Bold: bold}}
		if bold {
			st.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFF4B3"}}
			st.Border = []excelize.Border{{Type: "top", Color: hex(navy), Style: 1}}
		}
		switch c.Kind {
		case KindDatetime:
			st.CustomNumFmt = ptr("yyyy-mm-dd hh:mm")
		case KindDuration:
			st.CustomNumFmt = ptr("[h]:mm:ss")
		case KindMoney:
			st.NumFmt = 4 // #,##0.00
		case KindNumber, KindSpeed:
			if c.Decimals > 0 {
				st.CustomNumFmt = ptr("#,##0." + strings.Repeat("0", c.Decimals))
			} else {
				st.NumFmt = 3 // #,##0
			}
		}
		return f.NewStyle(st)
	}
	n := len(rep.Columns)
	styles := make([]int, n)
	totalStyles := make([]int, n)
	for i, c := range rep.Columns {
		if styles[i], err = styleFor(c, false); err != nil {
			return err
		}
		if totalStyles[i], err = styleFor(footerColumn(c, i), true); err != nil {
			return err
		}
	}

	sw, err := f.NewStreamWriter(name)
	if err != nil {
		return err
	}
	for i, wd := range columnWidths(rep, loc) {
		if err := sw.SetColWidth(i+1, i+1, min(max(wd+2, 9), 60)); err != nil {
			return err
		}
	}
	if err := sw.SetPanes(&excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return err
	}
	header := make([]any, n)
	for i, c := range rep.Columns {
		header[i] = excelize.Cell{StyleID: headerStyle, Value: headerLabel(c)}
	}
	if err := sw.SetRow("A1", header, excelize.RowOpts{Height: 22}); err != nil {
		return err
	}
	cellValue := func(c Column, v any) any {
		if v == nil {
			return nil
		}
		switch c.Kind {
		case KindDatetime:
			if t, ok := toTime(v); ok {
				return excelSerial(t, loc)
			}
		case KindDuration:
			if x, ok := toFloat(v); ok {
				return x / 86400
			}
		case KindNumber, KindSpeed, KindMoney:
			if x, ok := toFloat(v); ok {
				return x
			}
		}
		return formatValue(c, v, loc)
	}
	rowNum := 2
	writeRow := func(row Row, footer bool) error {
		vals := make([]any, n)
		for i, c := range rep.Columns {
			st := styles[i]
			if footer {
				c, st = footerColumn(c, i), totalStyles[i]
			}
			vals[i] = excelize.Cell{StyleID: st, Value: cellValue(c, row[c.Key])}
		}
		cell, _ := excelize.CoordinatesToCellName(1, rowNum)
		rowNum++
		return sw.SetRow(cell, vals)
	}
	for _, row := range rep.Rows {
		if err := writeRow(row, false); err != nil {
			return err
		}
	}
	for _, row := range footerRows(rep) {
		if err := writeRow(row, true); err != nil {
			return err
		}
	}
	if err := sw.Flush(); err != nil {
		return err
	}
	if n > 0 && len(rep.Rows) > 0 {
		last, _ := excelize.CoordinatesToCellName(n, 1+len(rep.Rows))
		if err := f.AutoFilter(name, "A1:"+last, nil); err != nil {
			return err
		}
	}

	// Info sheet.
	info := "Info"
	if _, err := f.NewSheet(info); err != nil {
		return err
	}
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	brand, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14, Color: hex(navy)}})
	lines := [][2]string{
		{BrandName, ""},
		{"Report", rep.Title},
		{"Period", periodText(rep, loc)},
		{"Time zone", loc.String()},
		{"Generated", generated.In(loc).Format(exportTimeLayout)},
		{"Rows", strconv.Itoa(len(rep.Rows))},
	}
	if rep.Subtitle != "" {
		lines = append(lines, [2]string{"Notes", rep.Subtitle})
	}
	if rep.Truncated {
		lines = append(lines, [2]string{"Truncated", fmt.Sprintf("only the first %d rows are included", MaxRows)})
	}
	for i, l := range lines {
		a, _ := excelize.CoordinatesToCellName(1, i+1)
		b, _ := excelize.CoordinatesToCellName(2, i+1)
		_ = f.SetCellValue(info, a, l[0])
		_ = f.SetCellValue(info, b, l[1])
		st := bold
		if i == 0 {
			st = brand
		}
		_ = f.SetCellStyle(info, a, a, st)
	}
	_ = f.SetColWidth(info, "A", "A", 14)
	_ = f.SetColWidth(info, "B", "B", 60)
	f.SetActiveSheet(0)
	_, err = f.WriteTo(w)
	return err
}

func ptr[T any](v T) *T { return &v }

func periodText(rep *Report, loc *time.Location) string {
	return rep.From.In(loc).Format(exportTimeLayout) + " – " + rep.To.In(loc).Format(exportTimeLayout)
}

// WritePDF writes the report as a landscape A4 PDF with the Somtel header
// (navy bar, gold rule, brand text, title, period, generated-at), a table
// whose header repeats on every page, and page numbers.
func WritePDF(w io.Writer, rep *Report, loc *time.Location, generated time.Time) error {
	if loc == nil {
		loc = time.UTC
	}
	const (
		margin = 10.0
		rowH   = 6.0
		headH  = 8.0
	)
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(margin, margin, margin)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AliasNbPages("{nb}")
	pdf.SetTitle(BrandName+" – "+rep.Title, true)
	pdf.SetAuthor(BrandName, true)
	pdf.SetCreator(BrandName, true)
	tr := pdf.UnicodeTranslatorFromDescriptor("") // UTF-8 -> cp1252 for the core fonts
	pageW, pageH := pdf.GetPageSize()
	usable := pageW - 2*margin

	n := len(rep.Columns)
	fontSize := 8.0
	if n > 9 {
		fontSize = 7.0
	}
	// Column widths: proportional to content, capped, scaled to the page.
	pdf.SetFont("Helvetica", "", fontSize)
	widths := make([]float64, n)
	for i, c := range rep.Columns {
		pdf.SetFont("Helvetica", "B", fontSize)
		widths[i] = pdf.GetStringWidth(tr(headerLabel(c))) + 4
		pdf.SetFont("Helvetica", "", fontSize)
		for k, row := range rep.Rows {
			if k >= 300 {
				break
			}
			widths[i] = max(widths[i], pdf.GetStringWidth(tr(formatValue(c, row[c.Key], loc)))+4)
		}
		widths[i] = min(widths[i], 70)
	}
	sum := 0.0
	for _, wd := range widths {
		sum += wd
	}
	if sum > 0 {
		for i := range widths {
			widths[i] *= usable / sum
		}
	}

	tableStarted := false
	drawTableHeader := func() {
		pdf.SetFont("Helvetica", "B", fontSize)
		pdf.SetFillColor(navy[0], navy[1], navy[2])
		pdf.SetTextColor(255, 255, 255)
		pdf.SetDrawColor(navy[0], navy[1], navy[2])
		for i, c := range rep.Columns {
			align := "L"
			if isNumeric(c.Kind) {
				align = "R"
			}
			pdf.CellFormat(widths[i], headH, fit(pdf, tr(headerLabel(c)), widths[i]-2), "0", 0, align, true, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetFillColor(gold[0], gold[1], gold[2])
		pdf.Rect(margin, pdf.GetY(), usable, 0.6, "F")
		pdf.SetY(pdf.GetY() + 0.6)
	}
	pdf.SetHeaderFunc(func() {
		// Navy bar with brand text, gold rule.
		pdf.SetFillColor(navy[0], navy[1], navy[2])
		pdf.Rect(0, 0, pageW, 16, "F")
		pdf.SetFillColor(gold[0], gold[1], gold[2])
		pdf.Rect(0, 16, pageW, 1.5, "F")
		pdf.SetXY(margin, 4)
		pdf.SetFont("Helvetica", "B", 16)
		pdf.SetTextColor(gold[0], gold[1], gold[2])
		pdf.CellFormat(pdf.GetStringWidth("Somtel")+1, 8, "Somtel", "", 0, "L", false, 0, "")
		pdf.SetTextColor(255, 255, 255)
		pdf.CellFormat(40, 8, "Fleet", "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetXY(pageW/2, 4)
		pdf.CellFormat(pageW/2-margin, 8, tr("Generated "+generated.In(loc).Format(exportTimeLayout)+" ("+loc.String()+")"),
			"", 0, "R", false, 0, "")
		// Title and period.
		pdf.SetXY(margin, 21)
		pdf.SetTextColor(navy[0], navy[1], navy[2])
		pdf.SetFont("Helvetica", "B", 14)
		pdf.CellFormat(usable, 7, tr(rep.Title), "", 1, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetTextColor(90, 90, 90)
		pdf.CellFormat(usable, 5, tr("Period: "+periodText(rep, loc)), "", 1, "L", false, 0, "")
		if rep.Subtitle != "" {
			pdf.SetFont("Helvetica", "I", 8)
			pdf.CellFormat(usable, 4.5, fit(pdf, tr(rep.Subtitle), usable), "", 1, "L", false, 0, "")
		}
		pdf.Ln(2)
		if tableStarted {
			drawTableHeader()
		}
	})
	pdf.SetFooterFunc(func() {
		pdf.SetY(pageH - 8)
		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(usable/2, 5, BrandName, "", 0, "L", false, 0, "")
		pdf.CellFormat(usable/2, 5, fmt.Sprintf("Page %d of {nb}", pdf.PageNo()), "", 0, "R", false, 0, "")
	})

	pdf.AddPage()
	if n == 0 || len(rep.Rows) == 0 {
		pdf.SetFont("Helvetica", "", 10)
		pdf.SetTextColor(60, 60, 60)
		pdf.CellFormat(usable, 10, "No data for this period.", "", 1, "L", false, 0, "")
		return pdf.Output(w)
	}
	tableStarted = true
	drawTableHeader()
	bottom := pageH - 12
	drawRow := func(row Row, idx int, footer bool) {
		if pdf.GetY()+rowH > bottom {
			pdf.AddPage()
		}
		style := ""
		switch {
		case footer:
			style = "B"
			pdf.SetFillColor(0xFF, 0xF4, 0xB3)
		case idx%2 == 1:
			pdf.SetFillColor(0xF3, 0xF4, 0xF8)
		default:
			pdf.SetFillColor(255, 255, 255)
		}
		pdf.SetFont("Helvetica", style, fontSize)
		pdf.SetTextColor(30, 30, 30)
		for i, c := range rep.Columns {
			if footer {
				c = footerColumn(c, i)
			}
			align := "L"
			if isNumeric(c.Kind) {
				align = "R"
			}
			txt := fit(pdf, tr(formatValue(c, row[c.Key], loc)), widths[i]-2)
			pdf.CellFormat(widths[i], rowH, txt, "", 0, align, true, 0, "")
		}
		pdf.Ln(-1)
	}
	for i, row := range rep.Rows {
		drawRow(row, i, false)
	}
	for _, row := range footerRows(rep) {
		drawRow(row, 0, true)
	}
	if rep.Truncated {
		pdf.SetFont("Helvetica", "I", 8)
		pdf.CellFormat(usable, 6, fmt.Sprintf("Only the first %d rows are included.", MaxRows), "", 1, "L", false, 0, "")
	}
	return pdf.Output(w)
}

// fit truncates s (already cp1252) with an ellipsis to the given width.
func fit(pdf *fpdf.Fpdf, s string, width float64) string {
	w := pdf.GetStringWidth(s)
	if w <= width {
		return s
	}
	const ell = "\x85" // … in cp1252
	b := []byte(s)
	if cut := int(float64(len(b))*width/w) + 1; cut < len(b) { // proportional first guess
		b = b[:cut]
	}
	for len(b) > 0 && pdf.GetStringWidth(string(b)+ell) > width {
		b = b[:len(b)-1]
	}
	return string(b) + ell
}
