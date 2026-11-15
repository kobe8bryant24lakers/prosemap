// Synthetic, isolated Keychain integration probe. Never accepts the app service.
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

#ifndef PROBE_REVISION
#define PROBE_REVISION 1
#endif

int main(int argc, char **argv) {
  const char *prefix = "com.prosemap.keychain-qa.";
  const char *account = "synthetic-account";
  const char *value = "synthetic-keychain-value";
  if (argc != 3 || strncmp(argv[2], prefix, strlen(prefix)) != 0) return 64;
  // This applies only to the probe process: an unexpected prompt becomes an
  // error rather than granting access or changing system-wide interaction.
  SecKeychainSetUserInteractionAllowed(false);
  OSStatus status;
  int matches = 0;
  if (strcmp(argv[1], "create") == 0) {
    status = SecKeychainAddGenericPassword(NULL, (UInt32)strlen(argv[2]), argv[2],
      (UInt32)strlen(account), account, (UInt32)strlen(value), value, NULL);
  } else if (strcmp(argv[1], "read") == 0) {
    UInt32 length = 0;
    void *data = NULL;
    status = SecKeychainFindGenericPassword(NULL, (UInt32)strlen(argv[2]), argv[2],
      (UInt32)strlen(account), account, &length, &data, NULL);
    matches = status == errSecSuccess && length == strlen(value) && memcmp(data, value, length) == 0;
    if (data) SecKeychainItemFreeContent(NULL, data);
  } else if (strcmp(argv[1], "delete") == 0) {
    SecKeychainItemRef item = NULL;
    status = SecKeychainFindGenericPassword(NULL, (UInt32)strlen(argv[2]), argv[2],
      (UInt32)strlen(account), account, NULL, NULL, &item);
    if (status == errSecSuccess) status = SecKeychainItemDelete(item);
    if (item) CFRelease(item);
  } else return 64;
  printf("{\"revision\":%d,\"status\":%d,\"matches\":%s}\n", PROBE_REVISION, (int)status, matches ? "true" : "false");
  return 0;
}
