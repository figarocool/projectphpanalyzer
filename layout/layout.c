#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <ctype.h>

#define MAX_NODES 50000
#define MAX_EDGES 200000
#define MAX_ID_LEN 512
#define ITERATIONS 300
#define K 80.0
#define WIDTH 3000.0
#define HEIGHT 3000.0

typedef struct {
  char id[MAX_ID_LEN];
  double x, y;
} Node;

typedef struct {
  int source;
  int target;
} Edge;

static Node nodes[MAX_NODES];
static Edge edges[MAX_EDGES];
static int nodeCount = 0;
static int edgeCount = 0;

static int findNode(const char *id) {
  for (int i = 0; i < nodeCount; i++)
    if (strcmp(nodes[i].id, id) == 0) return i;
  return -1;
}

/* ---- Minimal JSON parser ---- */
static FILE *jf;
static int jc;

static int nextTok(void) {
  do { jc = fgetc(jf); } while (jc != EOF && isspace(jc));
  return jc;
}

static int expect(int c) {
  if (jc != c) { fprintf(stderr, "JSON error: expected '%c' got '%c'\n", c, jc); return 0; }
  return 1;
}

/* Read a JSON string into buf (up to maxLen), returning 1 on success.
   jc is set to the character after the closing quote. */
static int readStr(char *buf, int maxLen) {
  if (jc != '"') return 0;
  int i = 0;
  while (i < maxLen - 1) {
    jc = fgetc(jf);
    if (jc == EOF) return 0;
    if (jc == '\\') { jc = fgetc(jf); if (jc == EOF) return 0; continue; }
    if (jc == '"') break;
    buf[i++] = (char)jc;
  }
  buf[i] = '\0';
  jc = fgetc(jf);
  return 1;
}

/* Skip any JSON value (string, number, object, array) */
static void skipVal(void) {
  if (jc == '"') {
    while (1) { jc = fgetc(jf); if (jc == EOF) return; if (jc == '\\') { fgetc(jf); continue; } if (jc == '"') break; }
    jc = fgetc(jf);
  } else if (jc == '{' || jc == '[') {
    int depth = 1;
    while (depth > 0) {
      jc = fgetc(jf);
      if (jc == EOF) return;
      if (jc == '"') while (1) { jc = fgetc(jf); if (jc == EOF) return; if (jc == '\\') fgetc(jf); else if (jc == '"') break; }
      else if (jc == '{' || jc == '[') depth++;
      else if (jc == '}' || jc == ']') depth--;
    }
    jc = fgetc(jf);
  } else {
    while (jc != EOF && jc != ',' && jc != '}' && jc != ']' && !isspace(jc)) jc = fgetc(jf);
  }
}

static int parseNodes(void) {
  nextTok();
  if (jc == ']') { nextTok(); return 1; }
  
  while (1) {
    if (!expect('{')) return 0;
    nextTok();
    
    while (jc == '"') {
      char k[64];
      if (!readStr(k, sizeof(k))) return 0;
      if (jc != ':') { fprintf(stderr, "Expected ':' after key\n"); return 0; }
      nextTok();
      if (strcmp(k, "id") == 0) {
        if (!readStr(nodes[nodeCount].id, MAX_ID_LEN)) return 0;
      } else {
        skipVal();
      }
      if (jc == ',') nextTok();
    }
    
    nodeCount++;
    if (nodeCount > MAX_NODES) { fprintf(stderr, "Too many nodes\n"); return 0; }
    if (!expect('}')) return 0;
    nextTok();
    if (jc == ']') { nextTok(); return 1; }
    if (jc != ',') { fprintf(stderr, "Expected ',' after node\n"); return 0; }
    nextTok();
  }
}

static int parseEdges(void) {
  nextTok();
  if (jc == ']') { nextTok(); return 1; }
  
  while (1) {
    if (!expect('{')) return 0;
    nextTok();
    
    char src[MAX_ID_LEN] = "", tgt[MAX_ID_LEN] = "";
    int fields = 0;
    
    while (jc == '"') {
      char k[64];
      if (!readStr(k, sizeof(k))) return 0;
      if (jc != ':') return 0;
      nextTok();
      char v[MAX_ID_LEN];
      if (!readStr(v, sizeof(v))) return 0;
      
      if (strcmp(k, "source") == 0) { strcpy(src, v); fields++; }
      else if (strcmp(k, "target") == 0) { strcpy(tgt, v); fields++; }
      
      if (jc == ',') nextTok();
    }
    
    if (fields >= 2 && src[0] && tgt[0]) {
      if (edgeCount < MAX_EDGES) {
        edges[edgeCount].source = findNode(src);
        edges[edgeCount].target = findNode(tgt);
        if (edges[edgeCount].source >= 0 && edges[edgeCount].target >= 0)
          edgeCount++;
      }
    }
    
    if (jc == '}') {
      nextTok();
      if (jc == ']') { nextTok(); return 1; }
      if (jc != ',') { fprintf(stderr, "Expected ',' in edges\n"); return 0; }
      nextTok();
    } else {
      fprintf(stderr, "Warning: expected '}' got '%c'\n", jc);
      nextTok();
    }
  }
  return 1;
}

static int parseGraph(void) {
  nextTok();
  if (!expect('{')) return 0;
  nextTok();
  
  while (jc == '"') {
    char k[64];
    if (!readStr(k, sizeof(k))) return 0;
    if (jc != ':') return 0;
    nextTok();
    
    if (strcmp(k, "nodes") == 0) { if (!parseNodes()) return 0; }
    else if (strcmp(k, "edges") == 0) { if (!parseEdges()) return 0; }
    else skipVal();
    
    if (jc == ',') nextTok();
  }
  
  return expect('}');
}

/* ---- Layout computation ---- */
static void initPositions(void) {
  int cols = (int)ceil(sqrt((double)nodeCount));
  if (cols < 1) cols = 1;
  double spacing = K * 1.2;
  for (int i = 0; i < nodeCount; i++) {
    int row = i / cols;
    int col = i % cols;
    nodes[i].x = spacing * col + ((double)rand() / RAND_MAX) * 50.0;
    nodes[i].y = spacing * row + ((double)rand() / RAND_MAX) * 50.0;
  }
}

static void computeLayout(void) {
  initPositions();
  
  double temp = 200.0;
  double k = K;
  double k2 = k * k;
  double width = (double)((int)(sqrt((double)nodeCount) * K * 1.5));
  double height = width;
  
  /* Build adjacency list */
  int *degree = calloc(nodeCount, sizeof(int));
  int *adj = calloc(edgeCount * 2, sizeof(int));
  
  for (int i = 0; i < edgeCount; i++) {
    degree[edges[i].source]++;
    degree[edges[i].target]++;
  }
  int *adjStart = calloc(nodeCount + 1, sizeof(int));
  int total = 0;
  for (int i = 0; i < nodeCount; i++) {
    adjStart[i] = total;
    total += degree[i];
    degree[i] = 0;
  }
  adjStart[nodeCount] = total;
  for (int i = 0; i < edgeCount; i++) {
    int s = edges[i].source, t = edges[i].target;
    if (s >= 0 && t >= 0) {
      adj[adjStart[s] + degree[s]++] = t;
      adj[adjStart[t] + degree[t]++] = s;
    }
  }
  
  double cx = width / 2.0;
  double cy = height / 2.0;
  
  for (int iter = 0; iter < ITERATIONS; iter++) {
    double maxDisp = 0;
    
    for (int i = 0; i < nodeCount; i++) {
      double fx = 0.0, fy = 0.0;
      
      /* Repulsive forces from all other nodes */
      for (int j = 0; j < nodeCount; j++) {
        if (i == j) continue;
        double dx = nodes[i].x - nodes[j].x;
        double dy = nodes[i].y - nodes[j].y;
        double dist = sqrt(dx * dx + dy * dy);
        if (dist < 1.0) dist = 1.0;
        double force = k2 / dist;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
      
      /* Attractive forces along edges */
      for (int e = adjStart[i]; e < adjStart[i + 1]; e++) {
        int j = adj[e];
        double dx = nodes[j].x - nodes[i].x;
        double dy = nodes[j].y - nodes[i].y;
        double dist = sqrt(dx * dx + dy * dy);
        if (dist < 1.0) dist = 1.0;
        double force = (dist * dist) / k;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
      
      /* Centering gravity */
      double gx = (cx - nodes[i].x) * 0.002 * k;
      double gy = (cy - nodes[i].y) * 0.002 * k;
      fx += gx;
      fy += gy;
      
      /* Apply with temperature limiting */
      double disp = sqrt(fx * fx + fy * fy);
      if (disp > 0) {
        double limited = disp < temp ? disp : temp;
        nodes[i].x += (fx / disp) * limited;
        nodes[i].y += (fy / disp) * limited;
        if (limited > maxDisp) maxDisp = limited;
      }
      
      /* Clamp to canvas */
      if (nodes[i].x < 10.0) nodes[i].x = 10.0;
      if (nodes[i].x > width - 10.0) nodes[i].x = width - 10.0;
      if (nodes[i].y < 10.0) nodes[i].y = 10.0;
      if (nodes[i].y > height - 10.0) nodes[i].y = height - 10.0;
    }
    
    temp *= 0.95;
    if (temp < 0.5) temp = 0.5;
    
    if (iter % 50 == 0) {
      fprintf(stderr, "PROGRESS:%d\n", (int)((double)iter / ITERATIONS * 100));
    }
  }
  
  fprintf(stderr, "PROGRESS:100\n");
  
  free(degree);
  free(adj);
  free(adjStart);
}

static void outputPositions(void) {
  printf("{\"positions\":{");
  for (int i = 0; i < nodeCount; i++) {
    if (i > 0) printf(",");
    printf("\"%s\":{\"x\":%.1f,\"y\":%.1f}", nodes[i].id, nodes[i].x, nodes[i].y);
  }
  printf("}}\n");
}

int main(void) {
  srand(42);
  jf = stdin;
  
  if (!parseGraph()) {
    fprintf(stderr, "ERROR: Failed to parse input JSON\n");
    fprintf(stderr, "PROGRESS:100\n");
    printf("{\"positions\":{}}\n");
    return 1;
  }
  
  fprintf(stderr, "Nodes: %d, Edges: %d\n", nodeCount, edgeCount);
  
  if (nodeCount == 0) {
    printf("{\"positions\":{}}\n");
    return 0;
  }
  
  computeLayout();
  outputPositions();
  
  return 0;
}
