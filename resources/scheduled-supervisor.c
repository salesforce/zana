#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;

static void request_stop(int signal_number) {
  (void)signal_number;
  stopping = 1;
}

static int wait_for_child(pid_t child, int *status, int grace_seconds) {
  struct timespec pause = { .tv_sec = 0, .tv_nsec = 20 * 1000 * 1000 };
  int ticks = grace_seconds * 50;
  while (ticks-- > 0) {
    pid_t result = waitpid(child, status, WNOHANG);
    if (result == child) return 1;
    if (result == -1 && errno == ECHILD) return 1;
    nanosleep(&pause, NULL);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) return 64;
  // Refuse group-wide signals unless node-pty made this helper the session's
  // group leader. A changed launcher must fail one run, never signal its host.
  if (getpgrp() != getpid()) return 73;
  struct sigaction action = { .sa_handler = request_stop };
  sigemptyset(&action.sa_mask);
  sigaction(SIGHUP, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGTERM, &action, NULL);

  pid_t child = fork();
  if (child < 0) return 71;
  if (child == 0) {
    execvp(argv[1], &argv[1]);
    _exit(127);
  }

  int status = 1;
  while (!stopping) {
    pid_t result = waitpid(child, &status, WNOHANG);
    if (result == child || (result == -1 && errno == ECHILD)) return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
    struct timespec pause = { .tv_sec = 0, .tv_nsec = 20 * 1000 * 1000 };
    nanosleep(&pause, NULL);
  }

  // node-pty made this supervisor the group leader. The target inherits that
  // group, so the leader remains live and prevents PGID reuse during grace.
  pid_t group = getpgrp();
  kill(-group, SIGTERM);
  if (!wait_for_child(child, &status, 1)) {
    // This deliberately kills the supervisor too. A stopped run is non-zero;
    // closeExpected maps only explicit successful lifecycle closes to zero.
    kill(-group, SIGKILL);
  }
  // A caller-requested close is normalized by PtyManager.closeExpected only.
  // An ordinary user/app close stays non-zero for scheduler error accounting.
  return 128 + SIGTERM;
}
