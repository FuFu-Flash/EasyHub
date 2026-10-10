/* Small analysis fixture, deliberately never executed by the smoke test. */
__attribute__((visibility("default"))) int easyhub_score(int value) {
  if (value < 0) return -1;
  return value * 3 + 7;
}

__attribute__((visibility("default"))) const char *easyhub_message(void) {
  return "EasyHub native analysis fixture";
}
