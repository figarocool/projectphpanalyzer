CC = gcc
CFLAGS = -O3 -march=native -flto -std=c11 -Wall -Wextra -Wpedantic
LDFLAGS = -lm -flto

.PHONY: all clean

all: layout

layout: layout.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

clean:
	rm -f layout
