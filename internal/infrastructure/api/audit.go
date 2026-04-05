package api

import (
	"encoding/base64"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ny4rl4th0t3p/chaincoord/internal/application/ports"
)

// GET /launch/{id}/audit
// Returns the audit log entries for a launch.  Post-launch, observer access.
//
// @Summary      Get audit log
// @Description  Returns all audit log entries for a launch. Visibility-gated (same rules as GET /launch/{id}).
// @Tags         audit
// @Produce      json
// @Param        id   path      string  true  "Launch UUID"
// @Success      200  {object}  map[string]interface{}
// @Failure      400  {object}  errorEnvelope
// @Failure      404  {object}  errorEnvelope
// @Router       /launch/{id}/audit [get]
func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	launchID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "launch id must be a valid UUID")
		return
	}

	// Visibility check.
	callerAddr := operatorFromContext(r.Context())
	if _, err := s.launches.GetLaunch(r.Context(), launchID, callerAddr); err != nil {
		writeServiceError(w, r, err)
		return
	}

	entries, err := s.auditLog.ReadForLaunch(r.Context(), launchID.String())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if entries == nil {
		entries = []ports.AuditEvent{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// GET /audit/pubkey
// Returns the server's Ed25519 audit public key so external verifiers can
// validate audit log entry signatures without access to server config.
//
// @Summary      Get audit public key
// @Description  Returns the server's Ed25519 public key for offline audit log signature verification.
// @Tags         audit
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /audit/pubkey [get]
func (s *Server) handleAuditPubKey(w http.ResponseWriter, _ *http.Request) {
	if s.auditPubKey == nil {
		writeError(w, http.StatusServiceUnavailable, "no_audit_key", "server has no audit signing key configured")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"public_key": base64.StdEncoding.EncodeToString(s.auditPubKey),
	})
}
