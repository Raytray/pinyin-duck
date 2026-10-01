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
    RimeContext ctx;
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

int main(int argc, char* argv[]) {
  RimeApi* rime = rime_get_api();
  rime->setup(0, 0);
  rime->initialize(0, 0);

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
