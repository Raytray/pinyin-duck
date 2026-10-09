// rime_smoke.cc — A small C++ harness that drives a real librime session.
//
// Speaks a line-based TSV protocol on stdin/stdout:
//   SCHEMA_LIST       -> lists available schemas
//   SCHEMA <id>       -> activates a schema
//   KEYS <keys>       -> simulates a key sequence
//   QUIT              -> exits
//
// Outputs:
//   SCHEMA_LIST <count>
//   SCHEMA <id> <name>
//   PREEDIT <text>
//   CANDIDATE <text>
//   COMMITTED <text>
//   QUERY_ERROR <message>

#include <rime_api.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static RimeSessionId session_id = 0;

void process_line(const std::string& line) {
  if (line == "SCHEMA_LIST") {
    RimeApi* rime = rime_get_api();
    RimeSchemaList list;
    rime->get_schema_list(&list);
    printf("SCHEMA_LIST %d\n", (int)list.size);
    for (size_t i = 0; i < list.size; i++) {
      printf("SCHEMA %s %s\n", list.list[i].schema_id, list.list[i].name);
    }
    rime->free_schema_list(&list);
    fflush(stdout);
  } else if (line.substr(0, 7) == "SCHEMA ") {
    std::string schema_id = line.substr(7);
    RimeApi* rime = rime_get_api();
    if (session_id) {
      rime->destroy_session(session_id);
    }
    session_id = rime->create_session();
    if (!session_id) {
      printf("QUERY_ERROR failed to create session\n");
      fflush(stdout);
      return;
    }
    bool ok = rime->select_schema(session_id, schema_id.c_str());
    if (!ok) {
      printf("QUERY_ERROR failed to select schema %s\n", schema_id.c_str());
      fflush(stdout);
      return;
    }
    printf("SCHEMA %s\n", schema_id.c_str());
    fflush(stdout);
  } else if (line.substr(0, 5) == "KEYS ") {
    std::string keys = line.substr(5);
    RimeApi* rime = rime_get_api();
    if (!session_id) {
      printf("QUERY_ERROR no session\n");
      fflush(stdout);
      return;
    }
    for (char c : keys) {
      rime->process_key(session_id, c, 0);
    }
    // Read context
    // RIME_STRUCT, not a bare declaration: RimeGetContext rejects a struct whose
    // data_size is <= 0, and an uninitialized local has an arbitrary value there, so
    // every query would report "no context" while the engine was working fine.
    RIME_STRUCT(RimeContext, ctx);
    if (rime->get_context(session_id, &ctx)) {
      if (ctx.composition.preedit) {
        printf("PREEDIT %s\n", ctx.composition.preedit);
      }
      if (ctx.menu.num_candidates) {
        for (int i = 0; i < ctx.menu.num_candidates; i++) {
          printf("CANDIDATE %s\n", ctx.menu.candidates[i].text);
        }
      }
      rime->free_context(&ctx);
    }
    // A digit typed while composing selects the candidate under it, which commits it and
    // leaves an empty menu. Without this line a committed query is indistinguishable from
    // one that matched nothing, because both report zero candidates.
    RIME_STRUCT(RimeCommit, commit);
    if (rime->get_commit(session_id, &commit)) {
      printf("COMMITTED %s\n", commit.text ? commit.text : "");
      rime->free_commit(&commit);
    }
    fflush(stdout);
  } else if (line == "QUIT") {
    RimeApi* rime = rime_get_api();
    if (session_id) {
      rime->destroy_session(session_id);
      session_id = 0;
    }
    printf("QUIT\n");
    fflush(stdout);
    exit(0);
  }
}

int main() {
  RimeApi* rime = rime_get_api();
  if (rime == nullptr) {
    fprintf(stderr, "rime_get_api() returned null; librime is not usable.\n");
    return 2;
  }

  // The 1.x API takes a single RimeTraits*, not the two-argument form the pre-1.0 API
  // had, so `setup(0, 0)` does not compile.
  //
  // librime 1.13.1 reads no environment variables at all — there is no getenv() anywhere
  // in its source — so it cannot pick up RIME_USER_DIR or RIME_LOG_DIR the way an older
  // release did. Left unset, the deployer defaults both directories to "." (deployer.cc),
  // which would silently read schemas from the repository root instead of the staged
  // temporary directory. Reading them here, in the harness, is what keeps verify-rime.ts
  // in control of where the dictionaries are deployed from.
  RIME_STRUCT(RimeTraits, traits);
  const char* user_data_dir = getenv("RIME_USER_DIR");
  const char* log_dir = getenv("RIME_LOG_DIR");
  if (user_data_dir) {
    traits.user_data_dir = user_data_dir;
    traits.shared_data_dir = user_data_dir;
  }
  traits.distribution_name = "PinyinDuck";
  traits.distribution_code_name = "pinyinduck";
  traits.distribution_version = "0.1.0";
  traits.app_name = "rime.pinyinduck_verify";
  // "" means "log to stderr only", which is where compile errors land. The caller treats
  // stdout as data and stderr as diagnostics.
  traits.log_dir = log_dir ? log_dir : "";

  rime->setup(&traits);
  rime->initialize(&traits);

  // Deployment is what compiles the generated dictionaries into the binaries the
  // translators actually read. Without it the schema loads but every query comes back with
  // an empty menu, which looks like a ranking bug rather than a missing build step.
  if (rime->start_maintenance(True)) {
    rime->join_maintenance_thread();
  }

  char* line = nullptr;
  size_t len = 0;
  ssize_t read;

  while ((read = getline(&line, &len, stdin)) != -1) {
    // Strip newline
    while (read > 0 && (line[read-1] == '\n' || line[read-1] == '\r')) {
      line[--read] = '\0';
    }
    process_line(std::string(line, read));
  }

  free(line);
  rime->finalize();
  return 0;
}
