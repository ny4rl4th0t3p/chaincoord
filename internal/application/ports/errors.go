package ports

import "errors"

// Sentinel errors returned by repository implementations.
// Application services check against these using errors.Is.
var (
	ErrNotFound        = errors.New("not found")
	ErrConflict        = errors.New("conflict") // optimistic lock violation or duplicate
	ErrUnauthorized    = errors.New("unauthorized")
	ErrForbidden       = errors.New("forbidden")
	ErrBadRequest      = errors.New("bad request") // client-supplied value failed validation
	ErrTooManyRequests = errors.New("too many requests")
)
