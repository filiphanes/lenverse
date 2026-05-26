// server.c – Tiny file server + live WebSocket sync on /ws/
#include "mongoose.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dirent.h>
#include <sys/stat.h>
#include <pthread.h>
#include <limits.h>

static const char *base_dir = ".";

// ------------------------------------------------------------------
// Subscription management
struct client { struct mg_connection *c; struct client *next; };
struct subs   { char *path; struct client *clients; struct subs *next; };

static struct subs *subscriptions = NULL;
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;

static struct subs *find_or_create(const char *path) {
  struct subs *s;
  for (s = subscriptions; s; s = s->next)
    if (strcmp(s->path, path) == 0) return s;
  s = calloc(1, sizeof(*s));
  s->path = strdup(path);
  s->next = subscriptions;
  subscriptions = s;
  return s;
}

static void broadcast(const char *path, const char *data, size_t len) {
  pthread_mutex_lock(&mutex);
  struct subs *s = find_or_create(path);
  for (struct client *cl = s->clients; cl; cl = cl->next)
    mg_ws_send(cl->c, data, len, WEBSOCKET_OP_TEXT);
  pthread_mutex_unlock(&mutex);
}

// ------------------------------------------------------------------
// Plain-text directory listing (exactly like your Go version)
#define DIR_LISTING_BUF_SIZE 8192
static void send_dir_listing(struct mg_connection *c, const char *dir) {
  char buf[DIR_LISTING_BUF_SIZE] = {0}, *p = buf;
  size_t left = sizeof(buf) - 1;
  DIR *dp = opendir(dir);
  if (!dp) { mg_http_reply(c, 500, "", ""); return; }

  struct dirent *de;
  while ((de = readdir(dp)) != NULL && left > 10) {
    if (de->d_name[0] == '.') continue;
    char full[PATH_MAX];
    snprintf(full, sizeof(full), "%s/%s", dir, de->d_name);
    struct stat st;
    int isdir = (stat(full, &st) == 0 && S_ISDIR(st.st_mode));
    int n = snprintf(p, left, "%s%s\n", de->d_name, isdir ? "/" : "");
    if (n <= 0 || (size_t)n >= left) break;
    p += n; left -= n;
  }
  closedir(dp);
  mg_http_reply(c, 200,
                "Content-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\n",
                "%s", buf);
}

// ------------------------------------------------------------------
static void fn(struct mg_connection *c, int ev, void *ev_data) {
  if (ev == MG_EV_HTTP_MSG) {
    struct mg_http_message *hm = (struct mg_http_message *) ev_data;

    // ---------- WebSocket upgrade on /ws/ ----------
    if (mg_match(hm->uri, mg_str("/ws/#"), NULL)) {
      mg_ws_upgrade(c, hm, NULL);                 // <-- does the upgrade, returns void
      char path[PATH_MAX];
      struct mg_str uri = hm->uri;
      if (uri.len > 4) uri.buf += 4, uri.len -= 4; // strip "/ws/"
      mg_snprintf(path, sizeof(path), "%.*s", (int)uri.len, uri.buf);
if (!mg_path_is_sane(mg_str(path))) mg_snprintf(path, sizeof(path), ".");

      // Store normalized path in c->data (64 bytes available)
      mg_snprintf(c->data, sizeof(c->data), "%s", path);

      pthread_mutex_lock(&mutex);
      struct subs *s = find_or_create(path);
      struct client *cl = calloc(1, sizeof(*cl));
      cl->c = c; cl->next = s->clients; s->clients = cl;
      pthread_mutex_unlock(&mutex);

      // Send current file content
      char full[PATH_MAX];
      snprintf(full, sizeof(full), "%s/%s", base_dir, path);
      FILE *fp = fopen(full, "rb");
      if (fp) {
        fseek(fp, 0, SEEK_END);
        long sz = ftell(fp);
        if (sz >= 0) {
          fseek(fp, 0, SEEK_SET);
          size_t file_size = (size_t)sz;
          char *buf = malloc(file_size + 1);
          if (buf) {
            size_t bytes_read = fread(buf, 1, file_size, fp);
            mg_ws_send(c, buf, bytes_read, WEBSOCKET_OP_TEXT);
            free(buf);
          }
        }
        fclose(fp);
      }
      return;
    }

    // ---------- Normal HTTP ----------
    char path[PATH_MAX];
    struct mg_str uri = hm->uri;
    if (uri.len > 1 && uri.buf[0] == '/') { uri.buf++; uri.len--; }
    mg_snprintf(path, sizeof(path), "%.*s", (int)uri.len, uri.buf);
    mg_url_decode(path, strlen(path), path, sizeof(path), 0);
    if (!mg_path_is_sane(mg_str(path))) strcpy(path, ".");
    char full[PATH_MAX];
    snprintf(full, sizeof(full), "%s/%s", base_dir, path);

    if (mg_strcmp(hm->uri, mg_str("/")) == 0)
      snprintf(full, sizeof(full), "%s/index.html", base_dir);

    struct mg_http_serve_opts opts = {
      .extra_headers = "Access-Control-Allow-Origin: *\r\n"
    };

    if (mg_strcmp(hm->method, mg_str("GET")) == 0) {
      struct stat st;
      if (stat(full, &st) == 0 && S_ISDIR(st.st_mode)) {
        send_dir_listing(c, full);
      } else {
        mg_http_serve_file(c, hm, full, &opts);
      }

    } else if (mg_strcmp(hm->method, mg_str("PUT")) == 0) {
      FILE *fp = fopen(full, "wb");
      if (!fp) { mg_http_reply(c, 500, "", "write error"); return; }
      fwrite(hm->body.buf, 1, hm->body.len, fp);
      fclose(fp);
      broadcast(path, hm->body.buf, hm->body.len);
      mg_http_reply(c, 200, "Access-Control-Allow-Origin: *\r\n", "OK");

    } else if (mg_strcmp(hm->method, mg_str("OPTIONS")) == 0) {
      mg_http_reply(c, 200,
                    "Access-Control-Allow-Origin: *\r\n"
                    "Access-Control-Allow-Methods: GET, PUT, OPTIONS\r\n"
                    "Access-Control-Allow-Headers: Content-Type\r\n", "");

    } else {
      mg_http_reply(c, 405, "", "Method Not Allowed");
    }

  } else if (ev == MG_EV_WS_MSG) {
    struct mg_ws_message *wm = (struct mg_ws_message *) ev_data;
    char path[PATH_MAX];
    mg_snprintf(path, sizeof(path), "%s", c->data);
    char full[PATH_MAX];
    snprintf(full, sizeof(full), "%s/%s", base_dir, path);

    FILE *fp = fopen(full, "wb");
    if (fp) {
      fwrite(wm->data.buf, 1, wm->data.len, fp);
      fclose(fp);
      broadcast(path, wm->data.buf, wm->data.len);
    }

  } else if (ev == MG_EV_CLOSE && c->is_websocket) {
    char path[PATH_MAX];
    mg_snprintf(path, sizeof(path), "%s", c->data);
    pthread_mutex_lock(&mutex);
    struct subs *s = find_or_create(path);
    struct client **p = &s->clients;
    while (*p) {
      if ((*p)->c == c) { 
        struct client *tmp = *p; 
        *p = tmp->next; 
        free(tmp); 
        break; // Exit loop after removing the client
      }
      else p = &(*p)->next;
    }
    pthread_mutex_unlock(&mutex);
  }
}

// ------------------------------------------------------------------
int main(int argc, char *argv[]) {
  struct mg_mgr mgr;
  mg_mgr_init(&mgr);

  const char *listen = "http://0.0.0.0:5005";
  char *env_dir = getenv("LENVERSE_DIR");
  if (env_dir) base_dir = env_dir;
  
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "-d") == 0 && i + 1 < argc) base_dir = argv[++i];
    if (strcmp(argv[i], "-l") == 0 && i + 1 < argc) listen = argv[++i];
  }

  char abs[PATH_MAX];
  if (realpath(base_dir, abs) == NULL) {
    perror("realpath");
    strcpy(abs, ".");
  }
  printf("Serving: %s\n", abs);
  printf("Listen : %s\n", listen);
  printf("WS sync: ws://localhost:5005/ws/<path>\n");

  mg_http_listen(&mgr, listen, fn, NULL);
  for (;;) mg_mgr_poll(&mgr, 1000);
  mg_mgr_free(&mgr);
  return 0;
}
