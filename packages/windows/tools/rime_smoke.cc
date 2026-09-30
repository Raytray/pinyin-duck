// rime_smoke — drives a real librime over the generated PinyinDuck dictionaries.
//
// This is the only part of the verification that cannot be written in TypeScript. The
// unit tests pin the emitted format against a *reading* of librime's source; this
// program hands the same files to the actual engine, so a misreading shows up here as a
// failed deploy or an empty candidate list instead of on the user's desktop.
//
// It prints one tab-separated record per line on stdout, which verify-rime.ts parses:
//
//   SCHEMA       <schema_id>  <ok|fail>
//   SCHEMA_LIST  <id>,<id>,...
//   PREEDIT      <query>  <preedit text>
//   CANDIDATE    <query>  <index>  <text>  <comment>
//   COMMITTED    <query>  <text>
//   QUERY_ERROR  <query>  <detail>
//
// Anything librime itself logs goes to stderr, because traits.log_dir is set to "" and
// that is where the "dropping entry ... with invalid syllable" failures land. Keeping
// the two streams apart is what lets the caller treat stdout as data.
//
// Usage:
//   rime_smoke <user_data_dir> <shared_data_dir> <schema_id> [query...]

#include <rime_api.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace {

/**
 * Escapes one field so a record can never be split by its own contents.
 *
 * The generated dictionaries are already sanitized, so this should never fire — but a
 * field that broke the format would otherwise be indistinguishable from a record
 * boundary, and that is a confusing way to learn about a bad gloss.
 */
std::string escape(const char* raw) {
  std::string out;
  if (raw == nullptr) return out;
  for (const char* p = raw; *p; ++p) {
    switch (*p) {
      case '\\': out += "\\\\"; break;
      case '\t': out += "\\t"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      default: out += *p;
    }
  }
  return out;
}

/** Writes a tab-separated record. */
void record(const char* tag, const std::string& a) {
  std::printf("%s\t%s\n", tag, a.c_str());
}

void record(const char* tag, const std::string& a, const std::string& b) {
  std::printf("%s\t%s\t%s\n", tag, a.c_str(), b.c_str());
}

void record(const char* tag, const std::string& a, int b, const std::string& c,
            const std::string& d) {
  std::printf("%s\t%s\t%d\t%s\t%s\n", tag, a.c_str(), b, c.c_str(), d.c_str());
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: %s <user_data_dir> <shared_data_dir> <schema_id> [query...]\n", argv[0]);
    return 2;
  }
  const char* user_data_dir = argv[1];
  const char* shared_data_dir = argv[2];
  const char* schema_id = argv[3];

  RimeApi* rime = rime_get_api();
  if (rime == nullptr) {
    std::fprintf(stderr, "rime_get_api() returned null; librime is not usable.\n");
    return 2;
  }

  RIME_STRUCT(RimeTraits, traits);
  traits.shared_data_dir = shared_data_dir;
  traits.user_data_dir = user_data_dir;
  traits.distribution_name = "PinyinDuck";
  traits.distribution_code_name = "pinyinduck";
  traits.distribution_version = "0.1.0";
  traits.app_name = "rime.pinyinduck_verify";
  // "" means "log to stderr only", which is where the compile errors are.
  traits.log_dir = "";
  rime->setup(&traits);
  rime->initialize(NULL);

  // Maintenance is the step Weasel runs on install: it compiles both dictionaries and
  // resolves both schemas into .table.bin / .prism.bin. It runs on a worker thread, so
  // the join is what turns "queued" into "finished, and here is whether it worked".
  if (rime->start_maintenance(True)) {
    rime->join_maintenance_thread();
  }

  // The scheme list comes from default.custom.yaml, which patches the shared
  // default.yaml. A patch that does not apply leaves the list empty, and the user
  // finds out only after installing, so it is checked explicitly.
  // RimeSchemaList has no data_size, so the RIME_STRUCT initializer does not apply to it;
  // rime_api_console declares it plainly for the same reason.
  RimeSchemaList schema_list;
  std::string listed;
  if (rime->get_schema_list(&schema_list)) {
    for (size_t i = 0; i < schema_list.size; ++i) {
      if (i > 0) listed += ',';
      listed += escape(schema_list.list[i].schema_id);
    }
    rime->free_schema_list(&schema_list);
  }
  record("SCHEMA_LIST", listed);

  // Selecting the schema is the other half of "it loaded": a schema that parses but
  // fails to compile is still in the list, and only the session notices.
  int failures = 0;
  {
    RimeSessionId probe = rime->create_session();
    char current[128] = {0};
    const bool selected = rime->select_schema(probe, schema_id);
    const bool reported = rime->get_current_schema(probe, current, sizeof(current));
    const bool ok = selected && reported && std::strcmp(current, schema_id) == 0;
    if (ok) {
      record("SCHEMA", escape(schema_id), "ok");
    } else {
      failures++;
      record("SCHEMA", escape(schema_id), "fail");
      std::printf("SCHEMA_DETAIL\t%s\tselected=%d reported=%d current=%s\n", escape(schema_id).c_str(),
                  static_cast<int>(selected), static_cast<int>(reported), escape(current).c_str());
    }
    rime->destroy_session(probe);
  }

  // One session per query. Reusing a session would let an unfinished composition bleed
  // into the next query, which is exactly the kind of false pass that would make this
  // test worthless.
  for (int arg = 4; arg < argc; ++arg) {
    const char* query = argv[arg];
    RimeSessionId session = rime->create_session();
    if (session == 0) {
      failures++;
      record("QUERY_ERROR", escape(query), "no session");
      continue;
    }
    rime->select_schema(session, schema_id);

    if (!rime->simulate_key_sequence(session, query)) {
      failures++;
      record("QUERY_ERROR", escape(query), "keys not accepted");
      rime->destroy_session(session);
      continue;
    }

    RIME_STRUCT(RimeContext, context);
    if (!rime->get_context(session, &context)) {
      failures++;
      record("QUERY_ERROR", escape(query), "no context");
      rime->destroy_session(session);
      continue;
    }

    record("PREEDIT", escape(query), escape(context.composition.preedit));
    // A digit may have selected and committed a candidate. get_commit surfaces the
    // committed text so the caller can tell "committed 试" from "committed 是" — the whole
    // point of taking the digits out of the alphabet is that this now happens.
    RIME_STRUCT(RimeCommit, commit);
    if (rime->get_commit(session, &commit)) {
      record("COMMITTED", escape(query), escape(commit.text ? commit.text : ""));
      rime->free_commit(&commit);
    }
    const RimeMenu& menu = context.menu;
    for (int i = 0; i < menu.num_candidates; ++i) {
      record("CANDIDATE", escape(query), i, escape(menu.candidates[i].text),
             escape(menu.candidates[i].comment ? menu.candidates[i].comment : ""));
    }

    rime->free_context(&context);
    rime->destroy_session(session);
  }

  rime->finalize();
  return failures == 0 ? 0 : 1;
}
