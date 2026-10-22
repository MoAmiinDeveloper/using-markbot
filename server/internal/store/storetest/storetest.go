// Package storetest provides a PostgreSQL-backed store for tests in other
// packages.
package storetest

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Pool connects to TEST_DATABASE_URL using a freshly created schema, so
// test packages can share one database. It skips the test when the variable
// is unset.
func Pool(t testing.TB, schema string) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE; CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// New opens a store in a fresh schema.
func New(t testing.TB, schema string, opts store.Options) *store.Store {
	t.Helper()
	st, err := store.New(context.Background(), Pool(t, schema), opts)
	if err != nil {
		t.Fatal(err)
	}
	return st
}
