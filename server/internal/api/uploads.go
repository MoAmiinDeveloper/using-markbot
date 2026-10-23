package api

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// MaxUploadBytes is the attachment size limit (10 MB).
const MaxUploadBytes = 10 << 20

// uploadTypes maps the accepted (sniffed) content types to file extensions.
var uploadTypes = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"application/pdf": ".pdf",
}

// sniffType detects the content type from the first bytes; "" when it is
// not one of the accepted types.
func sniffType(head []byte) string {
	ct := http.DetectContentType(head)
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	if _, ok := uploadTypes[ct]; ok {
		return ct
	}
	// DetectContentType's PDF signature requires "%PDF-" exactly at the start.
	if bytes.HasPrefix(head, []byte("%PDF-")) {
		return "application/pdf"
	}
	return ""
}

// safeFileName keeps the base name of an uploaded file without path parts,
// control characters or quotes, at most 100 characters, with an extension
// matching the detected type.
func safeFileName(name, kind, ext string) string {
	name = strings.ReplaceAll(name, `\`, "/")
	if i := strings.LastIndexByte(name, '/'); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' || r == '\'' || r == '<' || r == '>' || r == ':' || r == '*' || r == '?' || r == '|' || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(strings.TrimSpace(name), ".")
	if r := []rune(name); len(r) > 100 {
		name = string(r[:100])
	}
	if name == "" {
		name = kind
	}
	cur := strings.ToLower(filepath.Ext(name))
	if cur != ext && !(ext == ".jpg" && cur == ".jpeg") {
		name += ext
	}
	return name
}

type uploadError struct {
	status int
	msg    string
}

func (e *uploadError) Error() string { return e.msg }

// upload stores a multipart attachment (fields file, kind, stopId) of job j.
func (s *Server) upload(w http.ResponseWriter, r *http.Request, j store.Job) {
	a, err := s.receiveUpload(w, r, j)
	if err != nil {
		var ue *uploadError
		if errors.As(err, &ue) {
			writeError(w, ue.status, ue.msg)
			return
		}
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func (s *Server) receiveUpload(w http.ResponseWriter, r *http.Request, j store.Job) (store.Attachment, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		return store.Attachment{}, &uploadError{http.StatusBadRequest, "a multipart/form-data body is required"}
	}
	dir := s.cfg.Dispatch.JobDir(j.ID)
	var (
		kind, stopRaw, fileName, ctype, tmpPath string
		size                                    int64
	)
	defer func() {
		if tmpPath != "" {
			_ = os.Remove(tmpPath)
		}
	}()
	tooLarge := &uploadError{http.StatusRequestEntityTooLarge, "file too large (max 10 MB)"}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				return store.Attachment{}, tooLarge
			}
			return store.Attachment{}, &uploadError{http.StatusBadRequest, "invalid multipart body"}
		}
		switch part.FormName() {
		case "kind", "stopId":
			b, err := io.ReadAll(io.LimitReader(part, 64))
			if err != nil {
				return store.Attachment{}, &uploadError{http.StatusBadRequest, "invalid multipart body"}
			}
			if part.FormName() == "kind" {
				kind = strings.TrimSpace(string(b))
			} else {
				stopRaw = strings.TrimSpace(string(b))
			}
		case "file":
			if tmpPath != "" {
				return store.Attachment{}, &uploadError{http.StatusBadRequest, "only one file per request"}
			}
			if err := os.MkdirAll(dir, 0o750); err != nil {
				return store.Attachment{}, err
			}
			f, err := os.CreateTemp(dir, ".upload-*")
			if err != nil {
				return store.Attachment{}, err
			}
			tmpPath, fileName = f.Name(), part.FileName()
			head := make([]byte, 512)
			n, rerr := io.ReadFull(part, head)
			head = head[:n]
			if rerr != nil && rerr != io.EOF && rerr != io.ErrUnexpectedEOF {
				f.Close()
				var mbe *http.MaxBytesError
				if errors.As(rerr, &mbe) {
					return store.Attachment{}, tooLarge
				}
				return store.Attachment{}, &uploadError{http.StatusBadRequest, "invalid multipart body"}
			}
			ctype = sniffType(head)
			if ctype == "" {
				f.Close()
				return store.Attachment{}, &uploadError{http.StatusUnsupportedMediaType, "file must be a JPEG, PNG, WebP or PDF"}
			}
			if _, err := f.Write(head); err != nil {
				f.Close()
				return store.Attachment{}, err
			}
			copied, cerr := io.Copy(f, io.LimitReader(part, MaxUploadBytes+1-int64(n)))
			size = int64(n) + copied
			if err := f.Close(); err != nil && cerr == nil {
				cerr = err
			}
			if cerr != nil {
				var mbe *http.MaxBytesError
				if errors.As(cerr, &mbe) {
					return store.Attachment{}, tooLarge
				}
				return store.Attachment{}, &uploadError{http.StatusBadRequest, "invalid multipart body"}
			}
			if size > MaxUploadBytes {
				return store.Attachment{}, tooLarge
			}
		}
		_ = part.Close()
	}
	if tmpPath == "" {
		return store.Attachment{}, &uploadError{http.StatusBadRequest, "file is required"}
	}
	if size == 0 {
		return store.Attachment{}, &uploadError{http.StatusBadRequest, "file is empty"}
	}
	ext := uploadTypes[ctype]
	if kind == "" {
		kind = "photo"
		if ctype == "application/pdf" {
			kind = "document"
		}
	}
	if !slices.Contains(store.AttachmentKinds, kind) {
		return store.Attachment{}, &uploadError{http.StatusBadRequest, "kind must be one of: photo, signature, document"}
	}
	var stopID *int64
	if stopRaw != "" && stopRaw != "null" {
		id, err := strconv.ParseInt(stopRaw, 10, 64)
		if err != nil || id <= 0 {
			return store.Attachment{}, &uploadError{http.StatusBadRequest, "stopId must be a positive integer"}
		}
		stopID = &id
	}
	stored := store.RandomToken(16) + ext
	if err := os.Rename(tmpPath, filepath.Join(dir, stored)); err != nil {
		return store.Attachment{}, err
	}
	tmpPath = filepath.Join(dir, stored) // removed by the deferred cleanup unless recorded
	a, err := s.cfg.Dispatch.AddAttachment(r.Context(), store.Attachment{
		JobID: j.ID, Kind: kind, StopID: stopID, Name: safeFileName(fileName, kind, ext), ContentType: ctype,
		Size: size, Path: filepath.ToSlash(filepath.Join("attachments", strconv.FormatInt(j.ID, 10), stored)),
		UserID: uidPtr(principalFrom(r.Context()).UserID),
	})
	if err != nil {
		return store.Attachment{}, err
	}
	tmpPath = ""
	return a, nil
}

func uidPtr(id int64) *int64 {
	if id == 0 {
		return nil
	}
	return &id
}

// handleFile serves an attachment to users who may see its job (drivers:
// only their own jobs).
func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	var a store.Attachment
	if err == nil {
		a, err = s.store.Attachment(r.Context(), id)
	}
	var j store.Job
	if err == nil {
		j, err = s.store.Job(r.Context(), a.JobID)
	}
	if err == nil && !s.jobVisible(r, &j) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, attachmentNotFound)
		return
	}
	// The stored path is server-generated; still refuse anything escaping the data dir.
	rel := filepath.FromSlash(a.Path)
	if !filepath.IsLocal(rel) {
		writeError(w, http.StatusNotFound, attachmentNotFound)
		return
	}
	f, err := os.Open(filepath.Join(s.cfg.Dispatch.DataDir(), rel))
	if err != nil {
		s.log.Warn("attachment file missing", "id", a.ID, "path", a.Path, "err", err)
		writeError(w, http.StatusNotFound, attachmentNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		s.fail(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", a.ContentType)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=3600")
	disp := "inline"
	if r.URL.Query().Get("download") == "1" {
		disp = "attachment"
	}
	h.Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": a.Name}))
	http.ServeContent(w, r, "", st.ModTime(), f)
}
