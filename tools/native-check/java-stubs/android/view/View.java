package android.view;
public class View { public interface OnClickListener { void onClick(View v); } public void setOnClickListener(OnClickListener l) {} public final boolean requestFocus() { return false; } }
