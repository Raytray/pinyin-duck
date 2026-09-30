# ProGuard / R8 rules for PinyinDuck.
#
# This file is referenced by `app/build.gradle.kts` and must exist for the release
# build to run, even though there is nothing in it yet.
#
# The app has no reflection, no serialization, no JNI and no code generation, so there
# is nothing that needs an explicit keep rule. The two classes the platform instantiates
# by name — the input method service and the settings activity — are kept automatically
# because they are declared in the manifest, and the Compose compiler ships its own
# keep rules for the code it generates.
#
# Add rules here if a dependency ever needs them. Do not add a blanket
# `-keep class * { *; }`: that disables R8 entirely and hides the next missing rule
# behind a much larger APK.
