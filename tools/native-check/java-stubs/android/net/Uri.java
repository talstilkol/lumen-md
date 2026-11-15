package android.net;
public abstract class Uri implements android.os.Parcelable { public abstract String getHost(); public static Uri parse(String uriString) { return null; } public abstract String getScheme(); public abstract String toString(); }
