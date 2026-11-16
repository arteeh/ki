// touch < "MS X Y" lines: a finger on a touchscreen of its own (uinput),
// down at the first point, up 8 ms after the last; each event is dated
// when it is due, however late the busy phone gets to write it
#include <fcntl.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

static int fd;
static struct timespec t0;

static void at(double ms, const int *ev, int n) {
  long long ns = t0.tv_sec * 1000000000LL + t0.tv_nsec + (long long)(ms * 1e6);
  struct timespec due = { ns / 1000000000, ns % 1000000000 };
  clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &due, NULL);
  struct input_event e[16];
  for (int k = 0; k < n; k++) {
    e[k] = (struct input_event) { .time = { due.tv_sec, due.tv_nsec / 1000 }, .type = ev[3 * k], .code = ev[3 * k + 1], .value = ev[3 * k + 2] };
  }
  if (write(fd, e, n * sizeof *e) < 0) perror("touch: write");
}

int main(void) {
  static double p[4096][3];
  int n = 0;
  while (n < 4096 && scanf("%lf %lf %lf", &p[n][0], &p[n][1], &p[n][2]) == 3) n++;
  if (n == 0) return 1;
  fd = open("/dev/uinput", O_WRONLY);
  if (fd < 0) return perror("touch: /dev/uinput"), 1;
  int axes[][2] = { { ABS_MT_SLOT, 9 }, { ABS_MT_TRACKING_ID, 65535 }, { ABS_MT_POSITION_X, 1079 }, { ABS_MT_POSITION_Y, 2399 }, { ABS_MT_PRESSURE, 255 }, { ABS_MT_TOUCH_MAJOR, 255 } };
  ioctl(fd, UI_SET_EVBIT, EV_KEY);
  ioctl(fd, UI_SET_EVBIT, EV_ABS);
  ioctl(fd, UI_SET_KEYBIT, BTN_TOUCH);
  ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT);
  for (int k = 0; k < 6; k++) {
    struct uinput_abs_setup a = { .code = axes[k][0], .absinfo = { .maximum = axes[k][1] } };
    ioctl(fd, UI_SET_ABSBIT, axes[k][0]);
    ioctl(fd, UI_ABS_SETUP, &a);
  }
  struct uinput_setup s = { .id = { BUS_VIRTUAL, 0x18d1, 0x4ee7, 1 } };
  strcpy(s.name, "ki finger");
  if (ioctl(fd, UI_DEV_SETUP, &s) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) return perror("touch: uinput"), 1;
  // (Android opens a new device in a moment: events before are lost)
  usleep(300000);
  clock_gettime(CLOCK_MONOTONIC, &t0);
  int x = p[0][1], y = p[0][2];
  at(p[0][0], (int[]) { EV_ABS, ABS_MT_TRACKING_ID, 1, EV_ABS, ABS_MT_PRESSURE, 60, EV_ABS, ABS_MT_TOUCH_MAJOR, 8, EV_KEY, BTN_TOUCH, 1, EV_ABS, ABS_MT_POSITION_X, x, EV_ABS, ABS_MT_POSITION_Y, y, EV_SYN, SYN_REPORT, 0 }, 7);
  for (int k = 1; k < n; k++) {
    x = p[k][1], y = p[k][2];
    at(p[k][0], (int[]) { EV_ABS, ABS_MT_POSITION_X, x, EV_ABS, ABS_MT_POSITION_Y, y, EV_SYN, SYN_REPORT, 0 }, 3);
  }
  at(p[n - 1][0] + 8, (int[]) { EV_ABS, ABS_MT_TRACKING_ID, -1, EV_KEY, BTN_TOUCH, 0, EV_SYN, SYN_REPORT, 0 }, 3);
  // (gone at once, the device takes the touch with it: Android cancels it)
  usleep(100000);
  ioctl(fd, UI_DEV_DESTROY);
  return 0;
}
