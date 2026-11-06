get_filename_component(_quick_sqlite_root "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)

file(GLOB _quick_sqlite_cpp CONFIGURE_DEPENDS
  "${_quick_sqlite_root}/cpp/*.cpp"
  "${_quick_sqlite_root}/cpp/sqlite3.c")
file(GLOB_RECURSE _quick_sqlite_lexbor CONFIGURE_DEPENDS
  "${_quick_sqlite_root}/lexbor/*.c")
list(FILTER _quick_sqlite_lexbor EXCLUDE REGEX "/ports/windows_nt/")
if(WIN32)
  file(GLOB_RECURSE _quick_sqlite_lexbor CONFIGURE_DEPENDS
    "${_quick_sqlite_root}/lexbor/*.c")
  list(FILTER _quick_sqlite_lexbor EXCLUDE REGEX "/ports/posix/")
endif()

set_property(GLOBAL APPEND PROPERTY RN_GPUI_APP_CPP_SOURCES
  ${_quick_sqlite_cpp}
  ${_quick_sqlite_lexbor}
  "${_quick_sqlite_root}/better-trigram/better-trigram.c"
  "${_quick_sqlite_root}/sqlite3-fts5-html/fts5-html.c"
  "${CMAKE_CURRENT_LIST_DIR}/cpp/QuickSQLiteModule.cpp")
set_property(GLOBAL APPEND PROPERTY RN_GPUI_APP_CPP_INCLUDE_DIRS
  "${_quick_sqlite_root}"
  "${_quick_sqlite_root}/cpp"
  "${_quick_sqlite_root}/lexbor"
  "${CMAKE_CURRENT_LIST_DIR}/cpp")
set_property(GLOBAL APPEND PROPERTY RN_GPUI_APP_CPP_DEFINITIONS
  SQLITE_CORE=1
  SQLITE_ENABLE_FTS5=1
  SQLITE3MC_OMIT_AES_HARDWARE_SUPPORT=1
  HAVE_CIPHER_AES_128_CBC=0
  HAVE_CIPHER_AES_256_CBC=0
  HAVE_CIPHER_SQLCIPHER=0
  HAVE_CIPHER_RC4=0
  HAVE_CIPHER_CHACHA20=1
  SQLITE_OMIT_PROGRESS_CALLBACK=1
  SQLITE_MAX_EXPR_DEPTH=0
  SQLITE_OMIT_DEPRECATED=1
  SQLITE_LIKE_DOESNT_MATCH_BLOBS=1
  SQLITE_DQS=0
  SQLITE_DEFAULT_MEMSTATUS=0
  SQLITE_USE_ALLOCA=1
  SQLITE_ENABLE_REGEXP=1)
if(APPLE)
  set_property(GLOBAL APPEND PROPERTY RN_GPUI_APP_CPP_DEFINITIONS HAVE_FULLFSYNC=1)
endif()
