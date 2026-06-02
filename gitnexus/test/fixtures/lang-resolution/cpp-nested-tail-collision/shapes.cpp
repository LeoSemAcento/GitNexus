struct Outer {
  struct Inner {
    void from_outer() {}
    int outer_field;
  };
};
struct Other {
  struct Inner {
    void from_other() {}
  };
};
